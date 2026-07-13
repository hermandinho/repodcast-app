import { EpisodePipelineStage, EpisodeStatus, TranscriptSource, type Prisma } from "@prisma/client";
import { NonRetriableError } from "inngest";
import { prisma } from "@/server/db/client";
import { captureInngestFailure } from "@/server/observability/sentry";
import { signR2DownloadUrl } from "@/server/storage/r2";
import { DeepgramError, transcribeUrl } from "@/server/transcription/deepgram";
import type { Events } from "../events";
import { inngest } from "../client";

function truncateReason(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) return "Transcription failed";
  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
}

/**
 * Audio → transcript pipeline.
 *
 * Inputs: an Episode row with `audioUrl` holding the R2 object key (NOT
 * a URL — we sign one on demand). Source is UPLOAD (direct upload),
 * RSS (audio-fallback path from `import-rss-episode` when the publisher
 * didn't ship a transcript), or YOUTUBE (audio-fallback path from
 * `import-youtube-episode` when the video didn't have usable captions).
 *
 * Steps:
 *   1. Load + validate (source must be UPLOAD / RSS / YOUTUBE, audioUrl
 *      must be set, transcript must be empty so reruns don't clobber
 *      edits).
 *   2. Flip Episode → PROCESSING so the UI knows work is happening.
 *   3. Sign a 30-minute R2 GET URL — Deepgram fetches the audio itself.
 *   4. POST to Deepgram; persist the resulting transcript onto Episode.
 *   5. Fire `episode/generate.requested` so the existing pipeline runs
 *      unchanged.
 *
 * Failure modes are split:
 *   - `NonRetriableError` for missing-row / bad-state / 4xx Deepgram
 *     responses (no point retrying — the input is broken).
 *   - Anything else (5xx, network) falls through Inngest's default
 *     retry policy.
 *
 * Whisper fallback is deferred — needs OPENAI_API_KEY which
 * we don't ship yet. When it lands it slots in around step 4.
 */

const READ_URL_TTL_SEC = 30 * 60; // 30 min — outlasts most podcast transcribe jobs.

export const transcribeEpisode = inngest.createFunction(
  {
    id: "transcribe-episode",
    triggers: [{ event: "episode/transcribe.requested" }],
    retries: 3,
    /**
     * Terminal failure after retries. Flip stage/status → FAILED so the
     * SSE stream can close cleanly and the episode page renders the
     * "what went wrong" banner instead of hanging on <TranscribingPanel>
     * forever — same escape hatch as the RSS/YouTube/generate handlers.
     * Best-effort: never let the failure handler poison the queue.
     */
    onFailure: async ({ event, error }) => {
      const { episodeId } = event.data.event.data as Events["episode/transcribe.requested"]["data"];
      captureInngestFailure("transcribe", error, { episodeId });
      try {
        await prisma.episode.update({
          where: { id: episodeId },
          data: {
            status: EpisodeStatus.FAILED,
            stage: EpisodePipelineStage.FAILED,
            failureReason: truncateReason(error?.message ?? "Transcription failed"),
          },
        });
      } catch (err) {
        console.error("transcribe-episode onFailure persistence failed", err);
      }
    },
  },
  async ({ event, step }) => {
    const {
      episodeId,
      platforms,
      plan,
      agencyId: agencyIdFromEvent,
    } = event.data as Events["episode/transcribe.requested"]["data"];

    // ---- 1. Load + validate ----
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: {
        id: true,
        source: true,
        audioUrl: true,
        transcript: true,
        status: true,
        show: { select: { client: { select: { agencyId: true } } } },
      },
    });
    if (!episode) {
      throw new NonRetriableError(`Episode ${episodeId} not found`);
    }
    if (
      episode.source !== TranscriptSource.UPLOAD &&
      episode.source !== TranscriptSource.RSS &&
      episode.source !== TranscriptSource.YOUTUBE
    ) {
      throw new NonRetriableError(
        `Episode ${episodeId} source is ${episode.source}, not UPLOAD/RSS/YOUTUBE — refusing to transcribe`,
      );
    }
    if (!episode.audioUrl) {
      throw new NonRetriableError(
        `Episode ${episodeId} has no audio object key — upload didn't complete?`,
      );
    }
    const agencyId = agencyIdFromEvent ?? episode.show.client.agencyId;
    if (episode.transcript.trim().length > 0) {
      // Already has a transcript. Skip Deepgram + fire generate directly so
      // a re-fired event still kicks the generation pipeline. Nudge the
      // stage forward so the UI doesn't linger on TRANSCRIBING while we
      // wait for generate to pick up the event.
      await step.run("mark-generating", () =>
        prisma.episode.update({
          where: { id: episodeId },
          data: {
            status: EpisodeStatus.PROCESSING,
            stage: EpisodePipelineStage.GENERATING,
          },
        }),
      );
      await step.sendEvent("emit-generate", {
        name: "episode/generate.requested",
        data: { episodeId, platforms, plan, agencyId },
      });
      return { episodeId, skippedTranscription: true };
    }

    // ---- 2. Status → PROCESSING, stage → TRANSCRIBING ----
    await step.run("mark-processing", () =>
      prisma.episode.update({
        where: { id: episodeId },
        data: {
          status: EpisodeStatus.PROCESSING,
          stage: EpisodePipelineStage.TRANSCRIBING,
        },
      }),
    );

    // ---- 3. Sign R2 GET URL for Deepgram to fetch ----
    // Computed OUTSIDE step.run so we get a fresh signature on every
    // retry — a half-hour-old presign could expire mid-job.
    const audioKey = episode.audioUrl;
    const audioUrl = await signR2DownloadUrl(audioKey, READ_URL_TTL_SEC);

    // ---- 4. Deepgram call + persist transcript ----
    const transcribeResult = await step.run("deepgram-transcribe", async () => {
      try {
        const result = await transcribeUrl(audioUrl, { diarize: true });
        // Metadata surfaced back through the step return so it's visible
        // in the Inngest dashboard AND written to stdout for Vercel /
        // dev-terminal logs. The word/minute ratio is the diagnostic
        // signal — <10 WPM is almost always "audio is mostly music /
        // silence / non-speech," even when Deepgram happily reports a
        // non-empty transcript full of hallucinated repetitions.
        const wordCount = result.transcript.trim().split(/\s+/).filter(Boolean).length;
        const wordsPerMinute =
          result.durationSec != null && result.durationSec > 0
            ? wordCount / (result.durationSec / 60)
            : null;
        console.log(
          `[transcribe-episode] episodeId=${episodeId} deepgram-ok ` +
            `language=${result.language ?? "unknown"} ` +
            `durationSec=${result.durationSec ?? "unknown"} ` +
            `wordCount=${wordCount} ` +
            `wordsPerMinute=${wordsPerMinute != null ? wordsPerMinute.toFixed(1) : "unknown"}`,
        );
        return {
          transcript: result.transcript,
          words: result.words,
          durationSec: result.durationSec,
          language: result.language,
          wordCount,
          wordsPerMinute,
        };
      } catch (err) {
        // 4xx → input is broken (bad URL, unsupported codec, auth). Don't
        // retry. 5xx + network errors fall through to Inngest's retries.
        if (err instanceof DeepgramError && err.status >= 400 && err.status < 500) {
          throw new NonRetriableError(
            `Deepgram ${err.status}: ${err.message}. Body: ${err.body.slice(0, 200)}`,
          );
        }
        throw err;
      }
    });

    if (transcribeResult.transcript.trim().length === 0) {
      throw new NonRetriableError(
        `Deepgram returned an empty transcript for episode ${episodeId} — likely silence or unsupported codec`,
      );
    }

    // Persist transcript AND flip stage → GENERATING in one write. The
    // handoff to `generate-episode` may sit in the priority queue for a
    // few seconds; during that gap the pipeline is done with
    // transcription so <TranscribingPanel> should already be down. The
    // GENERATING panel (via source stage=generating) picks up until the
    // generate function's own `mark-processing` step confirms it started.
    await step.run("persist-transcript", () =>
      prisma.episode.update({
        where: { id: episodeId },
        data: {
          transcript: transcribeResult.transcript,
          // Persist per-word timings for the clip pipeline.
          // JSON column, cast to Prisma's JsonArray shape at write time.
          transcriptWords: transcribeResult.words as unknown as Prisma.InputJsonValue,
          stage: EpisodePipelineStage.GENERATING,
          durationSec:
            transcribeResult.durationSec != null
              ? Math.round(transcribeResult.durationSec)
              : undefined,
          // For UPLOAD sources whose audioUrl file happens to be
          // a video, populate sourceVideoUrl so the clip pipeline can use
          // the same object as its render source. Audio-only files will
          // still populate; the render worker's ffmpeg step surfaces
          // "no video stream" and the clip row is marked FAILED. Real
          // audiogram fallback lands later.
          sourceVideoUrl: episode.source === TranscriptSource.UPLOAD ? episode.audioUrl : undefined,
        },
      }),
    );

    // ---- 5. Hand off to the existing generation pipeline ----
    await step.sendEvent("emit-generate", {
      name: "episode/generate.requested",
      data: { episodeId, platforms, plan, agencyId },
    });

    return {
      episodeId,
      transcriptChars: transcribeResult.transcript.length,
      durationSec: transcribeResult.durationSec,
      language: transcribeResult.language,
      wordCount: transcribeResult.wordCount,
      wordsPerMinute: transcribeResult.wordsPerMinute,
    };
  },
);
