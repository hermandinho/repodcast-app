/**
 * Audio upload allowlist + extension map for Phase 2.7. Used by:
 *   - `signAudioUploadAction` (server-side content-type gate)
 *   - `<AudioUpload>` (client-side <input accept="…">)
 *   - `transcribe-episode.ts` (for the upload step's response logging)
 *
 * Stay conservative — the transcription pipeline downstream only needs
 * codecs Deepgram natively handles, and these cover what podcast tools
 * actually export.
 */

export const ALLOWED_AUDIO_CONTENT_TYPES = [
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

export type AllowedAudioContentType = (typeof ALLOWED_AUDIO_CONTENT_TYPES)[number];

/**
 * Hard ceiling on a single audio upload — Cloudflare R2's per-PUT limit
 * is much higher, but we stop at 500 MB so a misclicked video upload
 * doesn't run up egress bills before we error out.
 */
export const MAX_AUDIO_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

/**
 * Pick a sensible extension for the R2 object key. Mostly cosmetic (R2
 * doesn't care), but a recognisable extension helps Cloudflare's content-
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
