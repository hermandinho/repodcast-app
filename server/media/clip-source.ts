import "server-only";

import { TranscriptSource } from "@prisma/client";

/**
 * Resolve the render source for clip generation from an
 * Episode's field values, with a backwards-compatible fallback.
 *
 * The ingest commit populates `Episode.sourceVideoUrl` at ingest time:
 *   - YOUTUBE source → canonical watch URL
 *   - UPLOAD source  → the R2 object key from Episode.audioUrl
 *
 * Episodes that existed before that commit have `sourceVideoUrl = null`.
 * Rather than force a re-transcribe, we fall back to `audioUrl` when the
 * source is UPLOAD — because the uploaded file is either audio or video,
 * and ffmpeg will surface "no video stream" via the error translator
 * if the file happens to be audio-only.
 *
 * For RSS/PASTE/YOUTUBE sources, we do NOT fall back — those sources
 * either have their own `sourceVideoUrl` populated (YOUTUBE) or
 * lack a usable video source entirely (RSS = audio feed, PASTE = text).
 * Returning null keeps the UI's "not ready" state honest.
 *
 * @returns the effective source URL/key, or null if the episode isn't
 *   ready for clip generation.
 */
export function resolveClipSource(episode: {
  source: TranscriptSource;
  sourceVideoUrl: string | null;
  audioUrl: string | null;
}): string | null {
  if (episode.sourceVideoUrl) return episode.sourceVideoUrl;
  if (episode.source === TranscriptSource.UPLOAD && episode.audioUrl) {
    return episode.audioUrl;
  }
  return null;
}
