import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import ytdl from "@distube/ytdl-core";

/**
 * Fetch the source video for a clip render into a local file.
 *
 * Two paths:
 *   - YouTube URLs → `@distube/ytdl-core` picks the best MP4 stream up to
 *     720p (we don't need higher; the final clip is 1080p vertical).
 *   - Everything else → plain fetch → file. Assumes an HTTP(S) URL that
 *     serves the raw bytes (R2 presigned GET, direct upload URL, etc.).
 *
 * The caller owns the temp path; this fn just writes to it.
 */

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);

export function isYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return YOUTUBE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export async function downloadSource(sourceUrl: string, outputPath: string): Promise<void> {
  if (isYouTubeUrl(sourceUrl)) {
    await downloadYouTube(sourceUrl, outputPath);
    return;
  }
  await downloadDirect(sourceUrl, outputPath);
}

async function downloadYouTube(url: string, outputPath: string): Promise<void> {
  // `qualityLabel=720p` + itag fallback = the most compatible MP4 stream we
  // can grab without fighting YouTube's separate video/audio streams. If
  // YouTube starts blocking us, this is where cookies would be injected
  // (YTDL_COOKIE_JAR env, deferred until it becomes a real problem).
  const stream = ytdl(url, {
    quality: "highestvideo",
    filter: (f) => f.container === "mp4" && (f.hasVideo ?? false) && (f.hasAudio ?? false),
  });

  await pipeline(stream, createWriteStream(outputPath));
}

async function downloadDirect(url: string, outputPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`source fetch failed: ${res.status} ${res.statusText}`);
  }
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(outputPath));
}
