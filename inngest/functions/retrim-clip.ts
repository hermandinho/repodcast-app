import { NonRetriableError } from "inngest";
import { wordsToSrt } from "@/server/ai/highlight-selection";
import { prisma } from "@/server/db/client";
import {
  getClipById,
  markClipFailed,
  markClipReady,
  markClipRendering,
  updateClipBounds,
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
 * Q1 wk6 — re-render one existing VideoClip with new start/end bounds.
 *
 * Pipeline:
 *   1. Load clip + episode via tenant-scoped query.
 *   2. Update the clip's bounds up front (so a caller who reloads the
 *      page mid-render sees the new times even before render completes).
 *   3. Mark RENDERING, clear renderError.
 *   4. Build episode-wide SRT + resolve source URL (same as generate-clips).
 *   5. Fire renderClip() with the new bounds. outputPrefix uses a fresh
 *      timestamp so the resulting URL differs from the previous render's
 *      URL — sidesteps browser caching of the old MP4/JPEG.
 *   6. Mark READY (with new URLs) or FAILED.
 */

export const retrimClip = inngest.createFunction(
  {
    id: "retrim-clip",
    triggers: [{ event: "clip/retrim.requested" }],
    retries: 2,
    concurrency: [{ limit: 4 }, { scope: "fn", key: "event.data.agencyId", limit: 2 }],
    onFailure: async ({ event, error }) => {
      const { clipId } = event.data.event.data as Events["clip/retrim.requested"]["data"];
      captureInngestFailure("generate_clips", error, { clipId });
    },
  },
  async ({ event, step, logger }) => {
    const { clipId, agencyId, startMs, endMs } = event.data;

    if (endMs <= startMs) {
      throw new NonRetriableError(
        `retrim ${clipId}: endMs (${endMs}) must be greater than startMs (${startMs})`,
      );
    }

    // ---- 1. Load clip + episode ----
    const ctx = await step.run("load-clip", async () => {
      const clip = await getClipById(agencyId, clipId);
      if (!clip) {
        throw new NonRetriableError(`Clip ${clipId} not found for agency ${agencyId}`);
      }
      const episode = await prisma.episode.findUnique({
        where: { id: clip.episodeId },
        select: {
          id: true,
          sourceVideoUrl: true,
          transcriptWords: true,
        },
      });
      if (!episode || !episode.sourceVideoUrl || !episode.transcriptWords) {
        throw new NonRetriableError(
          `Clip ${clipId}'s episode is no longer eligible for rendering (missing sourceVideoUrl or transcriptWords)`,
        );
      }
      return { clip, episode };
    });

    const words = ctx.episode.transcriptWords as unknown as DeepgramWord[];
    if (!Array.isArray(words) || words.length === 0) {
      throw new NonRetriableError(`Clip ${clipId}: episode has empty transcriptWords`);
    }

    // ---- 2. Persist new bounds up front ----
    await step.run("update-bounds", () => updateClipBounds(clipId, { startMs, endMs }));

    // ---- 3. Mark RENDERING ----
    await step.run("mark-rendering", () => markClipRendering(clipId));

    // ---- 4. Prep SRT + source URL ----
    const captionsSrt = await step.run("build-srt", () => wordsToSrt(words));
    const isExternalUrl = /^https?:\/\//.test(ctx.episode.sourceVideoUrl!);
    const resolvedSourceUrl = isExternalUrl
      ? ctx.episode.sourceVideoUrl!
      : await step.run("sign-source-url", () =>
          signR2DownloadUrl(ctx.episode.sourceVideoUrl!, 60 * 60),
        );

    // ---- 5. Render ----
    return step.run("render", async () => {
      try {
        const renderTs = Date.now();
        const result = await renderClip({
          clipId,
          sourceUrl: resolvedSourceUrl,
          startMs,
          endMs,
          captionsSrt,
          aspect: "9:16",
          outputPrefix: `clips/${agencyId}/${ctx.episode.id}/${clipId}/${renderTs}`,
        });
        await markClipReady(clipId, {
          renderedUrl: result.renderedUrl,
          posterUrl: result.posterUrl,
        });
        return { clipId, status: "ready" as const };
      } catch (err) {
        const reason = extractRenderErrorReason(err);
        await markClipFailed(clipId, reason);
        logger.warn({ clipId, reason }, "retrim render failed");
        return { clipId, status: "failed" as const, reason };
      }
    });
  },
);

function extractRenderErrorReason(err: unknown): string {
  if (err instanceof RenderWorkerError) return `${err.status}: ${err.message}`;
  if (err instanceof RenderWorkerConfigError) return err.message;
  if (err instanceof Error) return err.message;
  return "unknown render error";
}
