import { EpisodeStatus, TranscriptSource } from "@prisma/client";
import { NonRetriableError } from "inngest";
import { prisma } from "@/server/db/client";
import { putR2Object } from "@/server/storage/r2";
import {
  downloadYouTubeAudio,
  fetchYouTubeMetadata,
  fetchCaptionText,
  MAX_DURATION_SEC,
  parseYouTubeVideoId,
  pickBestCaptionTrack,
  YouTubeImportError,
} from "@/server/imports/youtube";
import type { Events } from "../events";
import { inngest } from "../client";

/**
 * Phase 3.2 — YouTube import pipeline (yt-dlp-backed).
 *
 * Two-stage:
 *   1. Transcript-first — yt-dlp pulls captions (manual > auto, English
 *      preferred). If we get ≥ MIN_TRANSCRIPT_CHARS of prose, we persist
 *      it and fire `episode/generate.requested`.
 *   2. Audio-fallback — no captions (or too short). yt-dlp downloads
 *      the audio-only stream, we upload to R2, then hand off to
 *      `episode/transcribe.requested` (Deepgram). Mirrors the RSS
 *      audio-fallback path so the downstream pipeline is identical.
 *
 * onFailure flips the Episode to FAILED with actionable copy on the
 * `failureReason` column so the episode page can render a banner.
 * `NonRetriableError` codes (invalid_url / not_found / no_audio /
 * too_long / parse_failed) skip Inngest's retry budget.
 */

const MIN_TRANSCRIPT_CHARS = 500;

function truncateReason(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) return "YouTube import failed";
  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
}

/** These YouTubeImportError codes are terminal from the user's POV. */
const NON_RETRYABLE_YT_CODES = new Set([
  "invalid_url",
  "not_found",
  "no_audio",
  "parse_failed",
  "too_long",
]);

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
        showId: true,
        show: { select: { client: { select: { agencyId: true } } } },
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
      // Idempotent re-fire — transcript already filled. Skip to generate.
      await step.sendEvent("emit-generate", {
        name: "episode/generate.requested",
        data: { episodeId, platforms },
      });
      return { episodeId, skipped: true };
    }
    const agencyId = episode.show.client.agencyId;

    // ---- 2. Parse URL + fetch metadata ----
    const videoId = parseYouTubeVideoId(videoUrl);
    if (!videoId) {
      throw new NonRetriableError(
        `Couldn't parse a YouTube video id from ${videoUrl}. Paste a watch, youtu.be, embed, or shorts URL.`,
      );
    }

    // ---- 3. Status → PROCESSING ----
    await step.run("mark-processing", () =>
      prisma.episode.update({
        where: { id: episodeId },
        data: {
          status: EpisodeStatus.PROCESSING,
          // Overwrite externalUrl with the canonical watch URL — the
          // wizard put the raw user paste here; we prefer the yt-dlp-
          // parsed canonical form so the episode page's "watch source"
          // link always works.
          externalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        },
      }),
    );

    let metadata;
    try {
      metadata = await fetchYouTubeMetadata(videoId);
    } catch (err) {
      throw rewrapYouTubeError(err);
    }
    if (metadata.durationSec !== null && metadata.durationSec > MAX_DURATION_SEC) {
      const hours = Math.round(metadata.durationSec / 3600);
      throw new NonRetriableError(
        `Video is ${hours}h long — beyond the ${MAX_DURATION_SEC / 3600}h import cap. Try RSS or paste a manual transcript.`,
      );
    }

    // ---- 4a. Transcript-first path ----
    const track = pickBestCaptionTrack(metadata.captionLanguages, metadata.autoCaptionLanguages);
    if (track) {
      let transcript = "";
      try {
        transcript = await fetchCaptionText(videoId, track);
      } catch (err) {
        // Downgrade caption fetch failures to a soft signal — we'll
        // still try the audio-fallback path below rather than fail
        // outright. Log the reason for debugging.
        console.warn(
          `[import-youtube-episode] caption fetch failed for ${videoId}, falling through to audio: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      if (transcript.trim().length >= MIN_TRANSCRIPT_CHARS) {
        await step.run("persist-transcript", () =>
          prisma.episode.update({
            where: { id: episodeId },
            data: {
              transcript,
              durationSec: metadata.durationSec ?? undefined,
              // If the wizard didn't get a title from the user, use YouTube's.
              // Skip empty rewrites so we don't clobber a real title.
              ...(metadata.title ? { title: metadata.title } : {}),
            },
          }),
        );
        await step.sendEvent("emit-generate", {
          name: "episode/generate.requested",
          data: { episodeId, platforms },
        });
        return {
          episodeId,
          via: "captions" as const,
          transcriptChars: transcript.length,
          trackLanguage: track.languageCode,
          trackAuto: track.isGenerated,
        };
      }
      // Fall through to audio-fallback below.
    }

    // ---- 4b. Audio-fallback path ----
    const audioKey = await step.run("download-audio-to-r2", async () => {
      let audio;
      try {
        audio = await downloadYouTubeAudio(videoId);
      } catch (err) {
        throw rewrapYouTubeError(err);
      }
      const key = `audio/${agencyId}/${episode.showId}/${episodeId}.${extForContentType(audio.contentType)}`;
      await putR2Object(key, audio.buffer, audio.contentType);
      return key;
    });

    await step.run("persist-audio-key", () =>
      prisma.episode.update({
        where: { id: episodeId },
        data: {
          audioUrl: audioKey,
          durationSec: metadata.durationSec ?? undefined,
          ...(metadata.title ? { title: metadata.title } : {}),
        },
      }),
    );

    // Hand off to the existing audio pipeline. `transcribe-episode` accepts
    // YOUTUBE as a valid source (alongside UPLOAD + RSS), so the
    // Episode.source stays YOUTUBE — no source-flip like the earlier RSS
    // bug we squashed.
    await step.sendEvent("emit-transcribe", {
      name: "episode/transcribe.requested",
      data: { episodeId, platforms },
    });

    return {
      episodeId,
      via: "audio-fallback" as const,
      audioKey,
    };
  },
);

/**
 * Turn a YouTubeImportError into a NonRetriableError when the code is
 * terminal (user-fault, permanent, or bounded by our own limits). Other
 * errors bubble up so Inngest's retry budget picks them up.
 */
function rewrapYouTubeError(err: unknown): Error {
  if (err instanceof YouTubeImportError && NON_RETRYABLE_YT_CODES.has(err.code)) {
    return new NonRetriableError(err.message);
  }
  return err instanceof Error ? err : new Error(String(err));
}

function extForContentType(ct: string): string {
  switch (ct) {
    case "audio/mp4":
      return "m4a";
    case "audio/webm":
      return "webm";
    case "audio/ogg":
      return "opus";
    case "audio/mpeg":
      return "mp3";
    default:
      return "bin";
  }
}
