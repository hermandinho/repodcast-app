import { NonRetriableError } from "inngest";
import {
  buildImagePrompt,
  selectArtworkConcept,
  type ArtworkConcept,
} from "@/server/ai/artwork-concept";
import { prisma } from "@/server/db/client";
import { captureInngestFailure } from "@/server/observability/sentry";
import { putR2Object } from "@/server/storage/r2";
import { generateImage, WorkersAiError } from "@/server/media/workers-ai";
import type { Prisma } from "@prisma/client";
import type { KeyMoment } from "@/server/ai/key-moments";
import type { Events } from "../events";
import { inngest } from "../client";

/**
 * Q1 feature #4 — real artwork orchestrator.
 *
 * Pipeline:
 *   1. Load Episode + parent Show for voice-description context.
 *   2. Ask Claude for a single ArtworkConcept via `selectArtworkConcept`.
 *   3. For each of {16:9, 1:1, 9:16}, build a Flux prompt from the
 *      concept and call Workers AI. Serial, not parallel, because the
 *      Workers AI free tier has both a daily neuron cap AND per-account
 *      rate limits — bursting 3 requests risks throttling.
 *   4. Upload each PNG to R2 under `artwork/{agencyId}/{episodeId}/`.
 *   5. Persist all URLs + the concept in one write.
 *
 * If Claude returns a concept but Workers AI fails on ONE aspect,
 * we still save the ones that succeeded. Individual failures don't
 * roll back the whole run — better UX than "all-or-nothing".
 */

const R2_PUBLIC_BASE_URL = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL?.replace(/\/$/, "");

type AspectKey = "hero" | "square" | "vertical";
type AspectSpec = {
  key: AspectKey;
  aspect: "16:9" | "1:1" | "9:16";
  width: number;
  height: number;
  field: "heroImageUrl" | "squareCoverUrl" | "verticalCoverUrl";
};

// Flux-1-schnell caps at 1024×1024. We upscale on the display side.
const ASPECTS: readonly AspectSpec[] = [
  { key: "hero", aspect: "16:9", width: 1024, height: 576, field: "heroImageUrl" },
  { key: "square", aspect: "1:1", width: 1024, height: 1024, field: "squareCoverUrl" },
  { key: "vertical", aspect: "9:16", width: 576, height: 1024, field: "verticalCoverUrl" },
];

export const generateArtwork = inngest.createFunction(
  {
    id: "generate-artwork",
    triggers: [{ event: "episode/artwork.requested" }],
    retries: 2,
    concurrency: [{ limit: 5 }, { scope: "fn", key: "event.data.agencyId", limit: 3 }],
    onFailure: async ({ event, error }) => {
      const { episodeId } = event.data.event.data as Events["episode/artwork.requested"]["data"];
      captureInngestFailure("generate_artwork", error, { episodeId });
    },
  },
  async ({ event, step, logger }) => {
    const { episodeId, agencyId } = event.data;

    if (!R2_PUBLIC_BASE_URL) {
      throw new NonRetriableError(
        "NEXT_PUBLIC_R2_PUBLIC_BASE_URL is not set — artwork URLs would be unreachable",
      );
    }

    // ---- 1. Load + tenant guard ----
    const episode = await step.run("load-episode", async () => {
      const row = await prisma.episode.findUnique({
        where: { id: episodeId },
        select: {
          id: true,
          title: true,
          transcript: true,
          keyMoments: true,
          show: {
            select: {
              name: true,
              host: true,
              voiceDescription: true,
              client: { select: { agencyId: true } },
            },
          },
        },
      });
      if (!row) throw new NonRetriableError(`Episode ${episodeId} not found`);
      if (row.show.client.agencyId !== agencyId) {
        throw new NonRetriableError(`Episode ${episodeId} does not belong to agency ${agencyId}`);
      }
      if (!row.transcript || row.transcript.trim().length < 200) {
        throw new NonRetriableError(
          `Episode ${episodeId} has no usable transcript for concept selection`,
        );
      }
      return row;
    });

    // ---- 2. Concept ----
    const hookMoments = extractHookMoments(episode.keyMoments);
    const concept: ArtworkConcept = await step.run("select-concept", () =>
      selectArtworkConcept({
        episodeTitle: episode.title,
        showName: episode.show.name,
        hostName: episode.show.host,
        voiceDescription: episode.show.voiceDescription,
        transcript: episode.transcript,
        hookMoments,
      }),
    );

    // ---- 3+4. Render each aspect (serial, individual-failure tolerant) ----
    const urls: Partial<Record<AspectSpec["field"], string>> = {};
    const failures: { field: AspectSpec["field"]; error: string }[] = [];

    for (const spec of ASPECTS) {
      const result = await step.run(`render-${spec.key}`, async () => {
        try {
          const prompt = buildImagePrompt(concept, spec.aspect);
          const bytes = await generateImage({
            prompt,
            width: spec.width,
            height: spec.height,
            numSteps: 4,
          });
          const key = `artwork/${agencyId}/${episodeId}/${spec.key}-${Date.now()}.png`;
          await putR2Object(key, bytes, "image/png");
          return { ok: true as const, field: spec.field, url: `${R2_PUBLIC_BASE_URL}/${key}` };
        } catch (err) {
          const reason =
            err instanceof WorkersAiError
              ? `${err.status}: ${err.message}`
              : err instanceof Error
                ? err.message
                : String(err);
          logger.warn({ episodeId, aspect: spec.aspect, reason }, "artwork render failed");
          return { ok: false as const, field: spec.field, error: reason };
        }
      });
      if (result.ok) urls[result.field] = result.url;
      else failures.push({ field: result.field, error: result.error });
    }

    // ---- 5. Persist ----
    await step.run("persist-artwork", async () => {
      const data: Prisma.EpisodeUpdateInput = {
        artworkConcept: concept as unknown as Prisma.InputJsonValue,
        ...urls,
      };
      await prisma.episode.update({ where: { id: episodeId }, data });
    });

    return {
      episodeId,
      rendered: Object.keys(urls).length,
      failed: failures.length,
      failures,
    };
  },
);

/**
 * Squeeze the `KeyMoment[]` blob (server/ai/key-moments.ts) into a short
 * list of one-line hooks the concept prompt can lean on. Defensive
 * because keyMoments is JSON — schema may drift.
 */
function extractHookMoments(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is KeyMoment => typeof m === "object" && m !== null)
    .map((m) => `${m.topic}: ${m.quote}`)
    .slice(0, 5);
}
