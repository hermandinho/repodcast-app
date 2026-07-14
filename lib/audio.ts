/**
 * Upload allowlist + extension map for the episode source file.
 * Used by:
 *   - `signAudioUploadAction` (server-side content-type gate)
 *   - `<AudioUpload>` (client-side <input accept="…">)
 *   - `transcribe-episode.ts` (for the upload step's response logging)
 *
 * Accepts both audio and video containers: transcription pulls the
 * audio track from either shape, and video uploads populate
 * Episode.sourceVideoUrl so the clip pipeline can trim + burn captions
 * against the same file.
 */

const AUDIO_TYPES = [
  "audio/mpeg", // .mp3
  "audio/mp4", // .m4a (browsers often label it this)
  "audio/x-m4a",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/ogg",
  "audio/opus",
  "audio/flac",
  "audio/webm",
] as const;

const VIDEO_TYPES = [
  "video/mp4",
  "video/quicktime", // .mov
  "video/webm",
  "video/x-matroska", // .mkv
] as const;

export const ALLOWED_AUDIO_CONTENT_TYPES = [...AUDIO_TYPES, ...VIDEO_TYPES] as const;

export type AllowedAudioContentType = (typeof ALLOWED_AUDIO_CONTENT_TYPES)[number];

/** True when a content type carries a video track (drives clip readiness). */
export function isVideoContentType(value: string): boolean {
  return (VIDEO_TYPES as readonly string[]).includes(value);
}

/**
 * Hard ceiling on a single upload — R2's per-PUT limit is much higher,
 * but we stop at 2 GB so a misclicked upload doesn't run up bandwidth
 * before we error out. Video files are naturally larger than audio,
 * so this is 4x the pre-video ceiling.
 */
export const MAX_AUDIO_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

/**
 * Pick a sensible extension for the R2 object key. Mostly cosmetic (R2
 * doesn't care), but a recognisable extension helps CDN content-
 * disposition guesses and lets us debug the bucket browser without
 * cross-referencing the DB.
 */
export function audioExtensionFor(contentType: string, filename: string): string {
  const fromName = filename
    .split(".")
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (fromName && fromName.length <= 5) return fromName;
  switch (contentType) {
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
    case "audio/x-m4a":
      return "m4a";
    case "audio/aac":
      return "aac";
    case "audio/wav":
    case "audio/x-wav":
    case "audio/wave":
      return "wav";
    case "audio/ogg":
    case "audio/opus":
      return "ogg";
    case "audio/flac":
      return "flac";
    case "audio/webm":
      return "webm";
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    case "video/webm":
      return "webm";
    case "video/x-matroska":
      return "mkv";
    default:
      return "bin";
  }
}

export function isAllowedAudioContentType(value: string): value is AllowedAudioContentType {
  return (ALLOWED_AUDIO_CONTENT_TYPES as readonly string[]).includes(value);
}

export function formatAudioSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
