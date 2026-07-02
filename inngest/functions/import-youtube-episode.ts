import { EpisodeStatus, TranscriptSource } from "@prisma/client";
import { NonRetriableError } from "inngest";
import { prisma } from "@/server/db/client";
import { fetchYouTubeTranscript, YouTubeImportError } from "@/server/imports/youtube";
import type { Events } from "../events";
import { inngest } from "../client";

/**
 * Phase 3.2 — YouTube import pipeline.
 *
 * The importer:
 *   1. Loads the Episode + validates it's source=YOUTUBE and doesn't
 *      already have a transcript.
 *   2. Flips to PROCESSING so the UI shows the pipeline stepper.
 *   3. Parses the URL, fetches the captions, picks the best track, and
 *      persists the transcript onto the Episode.
 *   4. Fires `episode/generate.requested` so the rest of the pipeline
 *      runs unchanged.
 *
 * No audio-download fallback in v1 (see `server/imports/youtube.ts`
 * header for the reasoning). When a video has no captions, we surface
 * that as a `no_captions` failure with actionable copy so the episode
 * page can nudge the user to enable auto-captions or upload a transcript.
 */

const MIN_TRANSCRIPT_CHARS = 500;

function truncateReason(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) return "YouTube import failed";
  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
}

/** These import failures are terminal from the user's POV — retries don't
 *  help until the underlying situation changes (they turn captions on,
 *  fix the URL, unblock the video, etc.). */
const NON_RETRYABLE_CODES = new Set(["invalid_url", "not_found", "no_captions", "parse_failed"]);

export const importYoutubeEpisode = inngest.createFunction(
  {
    id: "import-youtube-episode",
    triggers: [{ event: "episode/youtube.import.requested" }],
    retries: 3,
    onFailure: async ({ event, error }) => {
      const { episodeId } = event.data.event
        .data as Events["episode/youtube.import.requested"]["data"];
      try {
        await prisma.episode.update({
          where: { id: episodeId },
          data: {
            status: EpisodeStatus.FAILED,
            failureReason: truncateReason(error?.message ?? "YouTube import failed"),
          },
        });
      } catch (err) {
        // Episode may have been deleted mid-run — don't let the handler
        // itself poison the queue.
        console.error("import-youtube-episode onFailure persistence failed", err);
      }
    },
  },
  async ({ event, step }) => {
    const { episodeId, videoUrl, platforms } =
      event.data as Events["episode/youtube.import.requested"]["data"];

    // ---- 1. Load + validate ----
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: {
        id: true,
        source: true,
        transcript: true,
      },
    });
    if (!episode) {
      throw new NonRetriableError(`Episode ${episodeId} not found`);
    }
    if (episode.source !== TranscriptSource.YOUTUBE) {
      throw new NonRetriableError(
        `Episode ${episodeId} source is ${episode.source}, not YOUTUBE — refusing to import`,
      );
    }
    if (episode.transcript.trim().length >= MIN_TRANSCRIPT_CHARS) {
      // Idempotent re-fire — transcript already filled. Skip straight to
      // generate so the dispatcher's retry still wakes up the pipeline.
      await step.sendEvent("emit-generate", {
        name: "episode/generate.requested",
        data: { episodeId, platforms },
      });
      return { episodeId, skipped: true };
    }

    // ---- 2. Status → PROCESSING ----
    await step.run("mark-processing", () =>
      prisma.episode.update({
        where: { id: episodeId },
        data: { status: EpisodeStatus.PROCESSING },
      }),
    );

    // ---- 3. Fetch captions ----
    // Deliberately runs OUTSIDE step.run — we don't want the ISO-string-
    // through-JSON round-trip Inngest does to `step.run` return values,
    // and the whole thing is idempotent anyway (re-fetching captions is
    // cheap and lands the same text).
    let result: Awaited<ReturnType<typeof fetchYouTubeTranscript>>;
    try {
      result = await fetchYouTubeTranscript(videoUrl);
    } catch (err) {
      if (err instanceof YouTubeImportError && NON_RETRYABLE_CODES.has(err.code)) {
        // Rewrap as NonRetriable so Inngest doesn't burn its budget on a
        // failure that won't fix itself.
        throw new NonRetriableError(err.message);
      }
      throw err;
    }

    if (result.transcript.trim().length < MIN_TRANSCRIPT_CHARS) {
      throw new NonRetriableError(
        `YouTube captions were too short (${result.transcript.trim().length} chars) — Claude needs at least ${MIN_TRANSCRIPT_CHARS} to generate outputs. Try a longer video, or upload a manual transcript.`,
      );
    }

    // ---- 4. Persist transcript + optional external URL ----
    await step.run("persist-transcript", () =>
      prisma.episode.update({
        where: { id: episodeId },
        data: {
          transcript: result.transcript,
          // `externalUrl` didn't exist yet on the row when the wizard
          // created the episode (source=YOUTUBE + audioUrl=null path).
          // Stash the canonical youtube.com URL so the episode page can
          // show a "watch source" link.
          externalUrl: `https://www.youtube.com/watch?v=${result.videoId}`,
        },
      }),
    );

    // ---- 5. Hand off to the generation pipeline ----
    await step.sendEvent("emit-generate", {
      name: "episode/generate.requested",
      data: { episodeId, platforms },
    });

    return {
      episodeId,
      transcriptChars: result.transcript.length,
      videoId: result.videoId,
      trackLanguage: result.track.languageCode,
      trackAuto: result.track.isGenerated,
    };
  },
);
