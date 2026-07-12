import { NonRetriableError } from "inngest";
import { selectHighlights, wordsToSrt } from "@/server/ai/highlight-selection";
import { prisma } from "@/server/db/client";
import {
  createClipsBatch,
  markClipFailed,
  markClipReady,
  markClipRendering,
} from "@/server/db/video-clips";
import {
  renderClip,
  RenderWorkerError,
  RenderWorkerConfigError,
} from "@/server/media/render-worker";
import { captureInngestFailure } from "@/server/observability/sentry";
import { signR2DownloadUrl } from "@/server/storage/r2";
import type { DeepgramWord } from "@/server/transcription/deepgram";
import type { Events } from "../events";
import { inngest } from "../client";

/**
 * Q1 wk4 — real generate-clips orchestrator.
 *
 * Pipeline:
 *   1. Load Episode + verify tenant + assert transcriptWords + sourceVideoUrl.
 *   2. Ask Claude for up to N clip candidates via `selectHighlights`.
 *   3. Create VideoClip rows in PENDING (batched, one $transaction).
 *   4. Build a whole-episode SRT from transcriptWords (worker slices per clip).
 *   5. For each clip, sequentially:
 *        RENDERING → renderClip() → READY (with URLs) | FAILED (with reason)
 *
 * Fan-out is serial inside a single Inngest function rather than one child
 * event per clip. Reasons:
 *   - The VPS worker's own in-process queue caps ffmpeg at 2 concurrent
 *     jobs, so more parallelism just contends for the same CPU.
 *   - The per-agency Inngest concurrency limit (2 in `event registry`) already
 *     rate-limits when multiple agencies fire in parallel.
 *   - Serial + `step.run` keeps each clip visible as its own row in the
 *     Inngest dashboard, which is enough for wk4.
 */

const MAX_CLIPS_DEFAULT = 5;

export const generateClips = inngest.createFunction(
  {
    id: "generate-clips",
    triggers: [{ event: "episode/clips.requested" }],
    retries: 2,
    concurrency: [{ limit: 4 }, { scope: "fn", key: "event.data.agencyId", limit: 2 }],
    onFailure: async ({ event, error }) => {
      const { episodeId } = event.data.event.data as Events["episode/clips.requested"]["data"];
      captureInngestFailure("generate_clips", error, { episodeId });
    },
  },
  async ({ event, step, logger }) => {
    const { episodeId, agencyId, maxClips } = event.data;
    const limit = Math.min(Math.max(maxClips ?? MAX_CLIPS_DEFAULT, 1), 10);

    // ---- 1. Load + tenant guard ----
    const episode = await step.run("load-episode", async () => {
      const row = await prisma.episode.findUnique({
        where: { id: episodeId },
        select: {
          id: true,
          title: true,
          sourceVideoUrl: true,
          transcriptWords: true,
          show: { select: { client: { select: { agencyId: true } } } },
        },
      });
      if (!row) throw new NonRetriableError(`Episode ${episodeId} not found`);
      if (row.show.client.agencyId !== agencyId) {
        throw new NonRetriableError(`Episode ${episodeId} does not belong to agency ${agencyId}`);
      }
      if (!row.sourceVideoUrl) {
        throw new NonRetriableError(
          `Episode ${episodeId} has no sourceVideoUrl — audio-only episode, use the audiogram path`,
        );
      }
      if (!row.transcriptWords || !Array.isArray(row.transcriptWords)) {
        throw new NonRetriableError(
          `Episode ${episodeId} has no transcriptWords — re-transcribe before requesting clips`,
        );
      }
      return row;
    });

    const words = episode.transcriptWords as unknown as DeepgramWord[];
    if (words.length === 0) {
      throw new NonRetriableError(`Episode ${episodeId} transcriptWords is empty`);
    }

    // ---- 2. Highlight selection ----
    const candidates = await step.run("select-highlights", () =>
      selectHighlights({ episodeTitle: episode.title, words, maxClips: limit }),
    );

    if (candidates.length === 0) {
      logger.info({ episodeId, agencyId }, "generate-clips: no candidates selected");
      return { episodeId, planned: 0, rendered: 0, failed: 0 };
    }

    // ---- 3. Persist PENDING rows ----
    const clips = await step.run("create-clip-rows", () =>
      createClipsBatch(
        agencyId,
        episodeId,
        candidates.map((c) => ({
          startMs: c.startMs,
          endMs: c.endMs,
          score: c.score,
          hookLine: c.hookLine,
          sourceVideoUrl: episode.sourceVideoUrl,
        })),
      ),
    );

    // ---- 4. Build episode-wide SRT once ----
    const captionsSrt = await step.run("build-srt", () => wordsToSrt(words));

    // ---- 5. Resolve source URL (sign if it's an R2 key) ----
    // sourceVideoUrl is either a full HTTP(S) URL (YouTube canonical, external
    // upload) or an R2 object key (uploaded via our own audio pipeline).
    const isExternalUrl = /^https?:\/\//.test(episode.sourceVideoUrl!);
    const resolvedSourceUrl = isExternalUrl
      ? episode.sourceVideoUrl!
      : await step.run(
          "sign-source-url",
          () => signR2DownloadUrl(episode.sourceVideoUrl!, 60 * 60), // 1h — worker holds source only briefly
        );

    // ---- 6. Render each clip ----
    let rendered = 0;
    let failed = 0;
    for (const clip of clips) {
      await step.run(`render-${clip.id}`, async () => {
        await markClipRendering(clip.id);
        try {
          // Timestamped path so each render lands on a fresh R2 key —
          // re-renders (wk6 retrim) get a new URL, so browser caches
          // and any <video> elements holding the old URL flip cleanly
          // instead of showing stale bytes. Old objects orphan; R2
          // lifecycle policy handles cleanup.
          const renderTs = Date.now();
          const result = await renderClip({
            clipId: clip.id,
            sourceUrl: resolvedSourceUrl,
            startMs: clip.startMs,
            endMs: clip.endMs,
            captionsSrt,
            aspect: "9:16",
            outputPrefix: `clips/${agencyId}/${episodeId}/${clip.id}/${renderTs}`,
          });
          await markClipReady(clip.id, {
            renderedUrl: result.renderedUrl,
            posterUrl: result.posterUrl,
          });
          rendered += 1;
          return { clipId: clip.id, status: "ready" };
        } catch (err) {
          const reason = extractRenderErrorReason(err);
          await markClipFailed(clip.id, reason);
          failed += 1;
          // Don't throw — a single bad clip shouldn't fail the whole batch.
          // Sentry catches individual failures at the app tier separately.
          logger.warn({ clipId: clip.id, reason }, "clip render failed");
          return { clipId: clip.id, status: "failed", reason };
        }
      });
    }

    return {
      episodeId,
      planned: clips.length,
      rendered,
      failed,
    };
  },
);

function extractRenderErrorReason(err: unknown): string {
  if (err instanceof RenderWorkerError) return `${err.status}: ${err.message}`;
  if (err instanceof RenderWorkerConfigError) return err.message;
  if (err instanceof Error) return err.message;
  return "unknown render error";
}
