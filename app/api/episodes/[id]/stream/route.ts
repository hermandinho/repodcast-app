import { type NextRequest } from "next/server";
import { OutputStatus, type GeneratedOutput, type Platform } from "@prisma/client";
import { requireAuthContext } from "@/server/auth/context";
import { ForbiddenError, NotFoundError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import { isLiveDb } from "@/server/data/source";
import { prisma } from "@/server/db/client";
import { getEpisode } from "@/server/db/episodes";
import { listOutputsForEpisode } from "@/server/db/outputs";

/**
 * Server-Sent Events stream for `/episodes/[id]`. Replaces the polling
 * fallback the outputs grid used while a generation was in flight.
 *
 * Wire format (text/event-stream):
 *   event: snapshot         — first frame: every current-version output
 *   event: output           — single platform changed (id / status / content / quality / version / versionCount / failureReason)
 *   event: episode          — episode status flipped (PROCESSING → READY etc.)
 *   event: done             — terminal: no GENERATING outputs left and episode is not PROCESSING
 *   : ping                  — heartbeat comment to keep proxies from idling out
 *
 * Tenancy is enforced once at connection setup via `getEpisode(ctx, id)`,
 * which throws on a cross-tenant id. Subsequent polls reuse the same
 * `agencyId`-anchored helpers, so a hijacked id can't surface another
 * tenant's outputs even if it leaked.
 *
 * Strategy: per-connection in-memory snapshot + DB poll at `POLL_MS`.
 * Polling (vs. LISTEN/NOTIFY or a real pub/sub) keeps infra unchanged
 * while still consolidating updates onto a single SSE connection per
 * viewer — much cheaper than the previous client-side polling pattern.
 * Swap for a pub/sub when scale demands it.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const POLL_MS = 1500;
const HEARTBEAT_MS = 15_000;
/** Hard cap so a stuck connection can't leak forever. Client reconnects. */
const MAX_DURATION_MS = 5 * 60_000;

const PLATFORM_TO_KEY: Record<Platform, string> = {
  TWITTER: "x",
  LINKEDIN: "li",
  INSTAGRAM: "ig",
  TIKTOK: "tt",
  SHOW_NOTES: "notes",
  BLOG: "blog",
  NEWSLETTER: "news",
};

const STATUS_TO_UI: Record<OutputStatus, string> = {
  GENERATING: "generating",
  READY: "ready",
  IN_REVIEW: "review",
  // Keep in sync with `EpisodeStatus` in `lib/sample-data/episode-status.ts`
  // and `STATUS_TO_KEY` in `server/data/source.ts`.
  AWAITING_CLIENT_APPROVAL: "awaiting-client",
  APPROVED: "approved",
  SCHEDULED: "scheduled",
  PUBLISHED: "published",
  FAILED: "failed",
};

type OutputPayload = {
  key: string;
  id: string;
  status: string;
  content: string;
  quality: number;
  version: number;
  versionCount: number;
  failureReason: string | null;
  sentToClientAtIso: string | null;
  clientApprovedAtIso: string | null;
};

type Snap = {
  id: string;
  status: OutputStatus;
  // Cheap change-detection without diffing the full text body.
  contentMark: string;
  quality: number;
  version: number;
  versionCount: number;
  failureReason: string | null;
  sentToClientAtIso: string | null;
  clientApprovedAtIso: string | null;
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Sample-data mode has no DB to poll; the UI gates this URL behind
  // `isLiveDb()` but defend in case the route is hit directly.
  if (!isLiveDb()) {
    return new Response("Live database not configured", { status: 503 });
  }

  const auth = await requireAuthContext();
  const ctx = toTenantContext(auth);

  try {
    await getEpisode(ctx, id);
  } catch (err) {
    if (err instanceof NotFoundError) return new Response("Not found", { status: 404 });
    if (err instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw err;
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      let durationTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (pollTimer) clearTimeout(pollTimer);
        if (durationTimer) clearTimeout(durationTimer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };

      const heartbeat = () => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      };

      // Client disconnect — Next forwards the abort signal here.
      req.signal.addEventListener("abort", cleanup);

      // Wall-clock cap.
      durationTimer = setTimeout(cleanup, MAX_DURATION_MS);

      const snap = new Map<string, Snap>();
      let lastEpisodeStatus: string | null = null;
      let firstFrame = true;

      const buildPayload = (
        o: GeneratedOutput,
        versionCount: number,
        failureReason: string | null,
      ): OutputPayload => ({
        key: PLATFORM_TO_KEY[o.platform],
        id: o.id,
        status: STATUS_TO_UI[o.status] ?? "ready",
        content: o.content,
        quality: o.quality ?? 0,
        version: o.version,
        versionCount,
        failureReason,
        sentToClientAtIso: o.sentToClientAt?.toISOString() ?? null,
        clientApprovedAtIso: o.clientApprovedAt?.toISOString() ?? null,
      });

      const poll = async (): Promise<void> => {
        if (closed) return;

        const [outputs, episode, versionGroups] = await Promise.all([
          listOutputsForEpisode(ctx, id),
          prisma.episode.findUnique({
            where: { id },
            select: { status: true },
          }),
          prisma.generatedOutput.groupBy({
            by: ["platform"],
            where: {
              episodeId: id,
              episode: { show: { client: { agencyId: ctx.agencyId } } },
            },
            _count: { _all: true },
          }),
        ]);

        if (!episode) {
          // Episode was deleted mid-stream. Tell the client and bail.
          send("done", { reason: "episode-not-found" });
          cleanup();
          return;
        }

        const versionCountByPlatform = new Map<Platform, number>(
          versionGroups.map((r) => [r.platform, r._count._all]),
        );

        // FAILED rows surface their reason from the latest transition note.
        // Skip the round-trip when nothing is failed.
        const failedIds = outputs.filter((o) => o.status === OutputStatus.FAILED).map((o) => o.id);
        const reasonById = new Map<string, string>();
        if (failedIds.length > 0) {
          const trans = await prisma.outputTransition.findMany({
            where: {
              outputId: { in: failedIds },
              toStatus: OutputStatus.FAILED,
            },
            orderBy: { createdAt: "desc" },
            select: { outputId: true, note: true },
          });
          for (const t of trans) {
            if (!reasonById.has(t.outputId) && t.note) {
              reasonById.set(t.outputId, t.note);
            }
          }
        }

        if (firstFrame) {
          // Initial frame: emit the whole grid at once so the client can
          // reconcile in one render.
          const payloads = outputs.map((o) =>
            buildPayload(
              o,
              versionCountByPlatform.get(o.platform) ?? 1,
              reasonById.get(o.id) ?? null,
            ),
          );
          for (const o of outputs) {
            snap.set(PLATFORM_TO_KEY[o.platform], {
              id: o.id,
              status: o.status,
              contentMark: `${o.content.length}:${o.updatedAt.getTime()}`,
              quality: o.quality ?? 0,
              version: o.version,
              versionCount: versionCountByPlatform.get(o.platform) ?? 1,
              failureReason: reasonById.get(o.id) ?? null,
              sentToClientAtIso: o.sentToClientAt?.toISOString() ?? null,
              clientApprovedAtIso: o.clientApprovedAt?.toISOString() ?? null,
            });
          }
          lastEpisodeStatus = episode.status;
          send("snapshot", { episodeStatus: episode.status, outputs: payloads });
          firstFrame = false;
        } else {
          // Delta frame: one `output` per changed slot, plus an `episode`
          // event if the parent flipped.
          for (const o of outputs) {
            const key = PLATFORM_TO_KEY[o.platform];
            const versionCount = versionCountByPlatform.get(o.platform) ?? 1;
            const failureReason = reasonById.get(o.id) ?? null;
            const cur: Snap = {
              id: o.id,
              status: o.status,
              contentMark: `${o.content.length}:${o.updatedAt.getTime()}`,
              quality: o.quality ?? 0,
              version: o.version,
              versionCount,
              failureReason,
              sentToClientAtIso: o.sentToClientAt?.toISOString() ?? null,
              clientApprovedAtIso: o.clientApprovedAt?.toISOString() ?? null,
            };
            const prev = snap.get(key);
            const changed =
              !prev ||
              prev.id !== cur.id ||
              prev.status !== cur.status ||
              prev.contentMark !== cur.contentMark ||
              prev.quality !== cur.quality ||
              prev.version !== cur.version ||
              prev.versionCount !== cur.versionCount ||
              prev.failureReason !== cur.failureReason ||
              prev.sentToClientAtIso !== cur.sentToClientAtIso ||
              prev.clientApprovedAtIso !== cur.clientApprovedAtIso;
            if (changed) {
              snap.set(key, cur);
              send("output", buildPayload(o, versionCount, failureReason));
            }
          }
          if (episode.status !== lastEpisodeStatus) {
            lastEpisodeStatus = episode.status;
            send("episode", { status: episode.status });
          }
        }

        // Terminal detection: no GENERATING outputs left AND parent episode
        // is not in PROCESSING. Send `done` so the client closes cleanly
        // instead of waiting for a heartbeat to time out.
        const anyGenerating = outputs.some((o) => o.status === OutputStatus.GENERATING);
        if (!anyGenerating && episode.status !== "PROCESSING") {
          send("done", { reason: "settled" });
          cleanup();
          return;
        }

        if (!closed) {
          pollTimer = setTimeout(() => {
            void poll().catch((err) => {
              // Surface as a `done` so the client can decide to retry, then
              // tear the connection down. Errors here are likely DB blips.
              console.error("[episodes/stream] poll error", err);
              send("done", { reason: "error" });
              cleanup();
            });
          }, POLL_MS);
        }
      };

      heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);

      // Kick off — `void` so the start() callback returns synchronously.
      void poll().catch((err) => {
        console.error("[episodes/stream] initial poll error", err);
        send("done", { reason: "error" });
        cleanup();
      });
    },
    cancel() {
      // Browser closed the stream. ReadableStream auto-tears, but the
      // cleanup() inside start() already drops the timers via the abort
      // listener — this branch is a safety net for runtime variants that
      // skip the abort dispatch.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // Nginx-style: disable buffering so each chunk flushes immediately.
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
