import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uploadFile } from "../lib/r2.js";
import {
  CaptionTrack,
  DownloadedAudio,
  VideoMetadata,
  downloadAudio,
  fetchCaptions,
  fetchMetadata,
} from "../lib/youtube.js";

const WORK_ROOT = process.env.WORK_DIR ?? tmpdir();

/**
 * Three job runners — one per app-side adapter fn. Each accepts an
 * already-validated payload (Fastify + zod handles that upstream) and
 * returns a JSON-safe object.
 *
 * Errors bubble as `YouTubeImportError`; the endpoint wrapper in
 * `server.ts` turns them into 400s with `{ error: { code, message,
 * stderr } }` so the app can re-hydrate the class on its side.
 */

export type MetadataJobOutput = VideoMetadata;

export async function jobMetadata(videoId: string): Promise<MetadataJobOutput> {
  return fetchMetadata(videoId);
}

export type CaptionsJobInput = { videoId: string; track: CaptionTrack };
export type CaptionsJobOutput = { transcript: string };

export async function jobCaptions(input: CaptionsJobInput): Promise<CaptionsJobOutput> {
  const transcript = await fetchCaptions(input.videoId, input.track);
  return { transcript };
}

export type AudioJobInput = {
  videoId: string;
  /** R2 key path without the extension — worker appends `.{ext}` based on the sniffed container. */
  keyPrefix: string;
  /** Byte ceiling — worker asks yt-dlp to abort past this. */
  maxBytes: number;
};
export type AudioJobOutput = {
  r2Key: string;
  contentType: string;
  sizeBytes: number;
};

export async function jobAudio(input: AudioJobInput): Promise<AudioJobOutput> {
  const jobDir = join(WORK_ROOT, `youtube-${input.videoId}-${process.pid}`);
  const tmpPath = join(jobDir, "audio.bin");
  await mkdir(jobDir, { recursive: true });
  try {
    const downloaded: DownloadedAudio = await downloadAudio(input.videoId, tmpPath, {
      maxBytes: input.maxBytes,
    });
    const r2Key = `${input.keyPrefix.replace(/\/$/, "")}.${downloaded.ext}`;
    await uploadFile(downloaded.path, r2Key, downloaded.contentType);
    return {
      r2Key,
      contentType: downloaded.contentType,
      sizeBytes: downloaded.sizeBytes,
    };
  } finally {
    // Nuke the scratch dir on both success and failure — 500 MB files
    // would eat the VPS's disk in an afternoon otherwise.
    await rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}
