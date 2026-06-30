import { EpisodeStatus, TranscriptSource } from "@prisma/client";
import { NonRetriableError } from "inngest";
import { prisma } from "@/server/db/client";
import { signR2DownloadUrl } from "@/server/storage/r2";
import { DeepgramError, transcribeUrl } from "@/server/transcription/deepgram";
import type { Events } from "../events";
import { inngest } from "../client";

/**
 * Phase 2.7 — audio → transcript pipeline.
 *
 * Inputs: an Episode row created with `source = UPLOAD` and `audioUrl`
 * holding the R2 object key (NOT a URL — we sign one on demand).
 *
 * Steps:
 *   1. Load + validate (source must be UPLOAD, audioUrl must be set,
 *      transcript must be empty so reruns don't clobber edits).
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
 * Whisper fallback is deferred (PLAN 2.7) — needs OPENAI_API_KEY which
 * we don't ship yet. When it lands it slots in around step 4.
 */

const READ_URL_TTL_SEC = 30 * 60; // 30 min — outlasts most podcast transcribe jobs.

export const transcribeEpisode = inngest.createFunction(
  {
    id: "transcribe-episode",
    triggers: [{ event: "episode/transcribe.requested" }],
    retries: 3,
  },
  async ({ event, step }) => {
    const { episodeId, platforms } = event.data as Events["episode/transcribe.requested"]["data"];

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
    if (episode.source !== TranscriptSource.UPLOAD) {
      throw new NonRetriableError(
        `Episode ${episodeId} source is ${episode.source}, not UPLOAD — refusing to transcribe`,
      );
    }
    if (!episode.audioUrl) {
      throw new NonRetriableError(
        `Episode ${episodeId} has no audio object key — upload didn't complete?`,
      );
    }
    if (episode.transcript.trim().length > 0) {
      // Already has a transcript. Skip Deepgram + fire generate directly so
      // a re-fired event still kicks the generation pipeline.
      await step.sendEvent("emit-generate", {
        name: "episode/generate.requested",
        data: { episodeId, platforms },
      });
      return { episodeId, skippedTranscription: true };
    }

    // ---- 2. Status → PROCESSING ----
    await step.run("mark-processing", () =>
      prisma.episode.update({
        where: { id: episodeId },
        data: { status: EpisodeStatus.PROCESSING },
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
        return {
          transcript: result.transcript,
          durationSec: result.durationSec,
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

    await step.run("persist-transcript", () =>
      prisma.episode.update({
        where: { id: episodeId },
        data: {
          transcript: transcribeResult.transcript,
          durationSec:
            transcribeResult.durationSec != null
              ? Math.round(transcribeResult.durationSec)
              : undefined,
        },
      }),
    );

    // ---- 5. Hand off to the existing generation pipeline ----
    await step.sendEvent("emit-generate", {
      name: "episode/generate.requested",
      data: { episodeId, platforms },
    });

    return {
      episodeId,
      transcriptChars: transcribeResult.transcript.length,
      durationSec: transcribeResult.durationSec,
    };
  },
);
