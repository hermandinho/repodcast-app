import { NonRetriableError } from "inngest";
import { wordsToSrt } from "@/server/ai/highlight-selection";
import {
  getOutputAudiogramContext,
  markAudiogramFailed,
  markAudiogramReady,
  markAudiogramRendering,
} from "@/server/db/output-audiograms";
import { prisma } from "@/server/db/client";
import {
  renderAudiogram,
  RenderWorkerError,
  RenderWorkerConfigError,
} from "@/server/media/render-worker";
import { captureInngestFailure } from "@/server/observability/sentry";
import { signR2DownloadUrl } from "@/server/storage/r2";
import type { DeepgramWord } from "@/server/transcription/deepgram";
import type { Events } from "../events";
import { inngest } from "../client";

/**
 * Q1 feature #5 — real audiogram orchestrator.
 *
 * Pipeline:
 *   1. Load output + parent episode + show artwork via tenant-scoped query.
 *   2. Read the audiogram window (startMs/endMs/aspect) off the output row
 *      — `requestAudiogramAction` writes it there before firing.
 *   3. Build episode-wide SRT from transcriptWords; the worker slices to
 *      the audiogram window at render time.
 *   4. Sign the R2 audio URL. Show artwork is already a public URL when
 *      present.
 *   5. Mark RENDERING → call worker's /render/audiogram → mark READY
 *      (URLs stored) or FAILED (renderError stored).
 */

export const generateAudiogram = inngest.createFunction(
  {
    id: "generate-audiogram",
    triggers: [{ event: "output/audiogram.requested" }],
    retries: 2,
    concurrency: [{ limit: 4 }, { scope: "fn", key: "event.data.agencyId", limit: 2 }],
    onFailure: async ({ event, error }) => {
      const { outputId } = event.data.event.data as Events["output/audiogram.requested"]["data"];
      captureInngestFailure("generate_audiogram", error, { outputId });
      // Best-effort — flip the row to FAILED so the UI stops showing
      // "rendering" forever after Inngest's retries give up.
      try {
        await markAudiogramFailed(outputId, error?.message ?? "unknown failure");
      } catch {
        // Row may have been deleted mid-run; nothing to do.
      }
    },
  },
  async ({ event, step, logger }) => {
    const { outputId, agencyId } = event.data;

    // ---- 1. Load + tenant guard ----
    const ctx = await step.run("load-output", async () => {
      const row = await getOutputAudiogramContext(agencyId, outputId);
      if (!row) {
        throw new NonRetriableError(`Output ${outputId} not found for agency ${agencyId}`);
      }
      if (row.agencyId !== agencyId) {
        throw new NonRetriableError(`Output ${outputId} does not belong to agency ${agencyId}`);
      }
      if (!row.audioUrl) {
        throw new NonRetriableError(
          `Output ${outputId}'s episode has no audio — audiogram needs source audio`,
        );
      }
      if (!row.transcriptWords || !Array.isArray(row.transcriptWords)) {
        throw new NonRetriableError(
          `Output ${outputId}'s episode has no transcriptWords — re-transcribe before requesting audiogram`,
        );
      }
      return row;
    });

    const words = ctx.transcriptWords as unknown as DeepgramWord[];
    if (words.length === 0) {
      throw new NonRetriableError(`Output ${outputId}: empty transcriptWords`);
    }

    // ---- 2. Read window from the output row ----
    // The action populated audiogramStartMs/EndMs/Aspect before firing.
    const params = await step.run("load-audiogram-params", async () => {
      const row = await prisma.generatedOutput.findUnique({
        where: { id: outputId },
        select: {
          audiogramStartMs: true,
          audiogramEndMs: true,
          audiogramAspect: true,
        },
      });
      if (!row || row.audiogramStartMs == null || row.audiogramEndMs == null) {
        throw new NonRetriableError(
          `Output ${outputId} has no audiogram params — action didn't run initAudiogram()?`,
        );
      }
      const aspect: "1:1" | "9:16" =
        row.audiogramAspect === "1:1" || row.audiogramAspect === "9:16"
          ? row.audiogramAspect
          : "9:16";
      return {
        startMs: row.audiogramStartMs,
        endMs: row.audiogramEndMs,
        aspect,
      };
    });

    // ---- 3. Prep SRT + audio URL ----
    const captionsSrt = await step.run("build-srt", () => wordsToSrt(words));
    const audioUrl = await step.run("sign-audio-url", () =>
      signR2DownloadUrl(ctx.audioUrl!, 60 * 60),
    );

    // ---- 4. Mark RENDERING ----
    await step.run("mark-rendering", () => markAudiogramRendering(outputId));

    // ---- 5. Render ----
    return step.run("render", async () => {
      try {
        const renderTs = Date.now();
        const result = await renderAudiogram({
          outputId,
          audioUrl,
          startMs: params.startMs,
          endMs: params.endMs,
          captionsSrt,
          aspect: params.aspect,
          backgroundImageUrl: ctx.showArtworkUrl,
          outputPrefix: `audiograms/${agencyId}/${ctx.episodeId}/${outputId}/${renderTs}`,
        });
        await markAudiogramReady(outputId, {
          renderedUrl: result.renderedUrl,
          posterUrl: result.posterUrl,
        });
        return { outputId, status: "ready" as const };
      } catch (err) {
        const reason = extractRenderErrorReason(err);
        await markAudiogramFailed(outputId, reason);
        logger.warn({ outputId, reason }, "audiogram render failed");
        return { outputId, status: "failed" as const, reason };
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
