import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractPoster, probeDurationSec, renderClipVideo, type Aspect } from "../lib/ffmpeg.js";

const MIN_CLIP_DURATION_SEC = 3;
import { uploadFile } from "../lib/r2.js";
import { downloadSource } from "../lib/source.js";
import { sliceSrt } from "../lib/srt.js";

/**
 * Q1 wk3 — clip render pipeline. Called per-clip from POST /render/clip.
 *
 * Steps (in order):
 *   1. Create scratch dir `/tmp/render/clip-{clipId}/`.
 *   2. Download source video (ytdl-core for YouTube, plain fetch otherwise).
 *   3. Slice + rebase the caller-provided SRT to the clip window.
 *   4. ffmpeg: trim → crop/scale to target aspect → burn captions → re-encode.
 *   5. ffmpeg: extract a poster JPEG at t=1 s of the rendered output.
 *   6. Upload MP4 + JPEG + SRT to R2 under `{outputPrefix}/{clip.mp4,poster.jpg,captions.srt}`.
 *   7. Delete the scratch dir on both success and failure.
 *   8. Return public URLs shaped as `${R2_PUBLIC_BASE_URL}/${key}`.
 *
 * On any error, the scratch dir is nuked and the error propagates —
 * server.ts catches and returns 500 with the message.
 */

export type ClipJobInput = {
  clipId: string;
  sourceUrl: string;
  startMs: number;
  endMs: number;
  captionsSrt: string;
  aspect: Aspect;
  outputPrefix: string;
};

export type ClipJobOutput = {
  clipId: string;
  renderedUrl: string;
  posterUrl: string;
  durationMs: number;
  bytes: number;
};

const WORK_ROOT = process.env.WORK_DIR ?? tmpdir();

export async function renderClip(input: ClipJobInput): Promise<ClipJobOutput> {
  const { clipId, sourceUrl, startMs, endMs, captionsSrt, aspect, outputPrefix } = input;

  const jobDir = join(WORK_ROOT, `clip-${clipId}`);
  const sourcePath = join(jobDir, "source.mp4");
  const srtPath = join(jobDir, "captions.srt");
  const outPath = join(jobDir, "clip.mp4");
  const posterPath = join(jobDir, "poster.jpg");

  await mkdir(jobDir, { recursive: true });

  try {
    // 1. Source
    await downloadSource(sourceUrl, sourcePath);

    // 2. Probe + clamp — the transcript may describe a longer episode
    //    than the actual source video (dev fixture, misconfigured
    //    Episode.sourceVideoUrl, etc.). If the requested window sits
    //    past the source's end we silently produce a 0-byte clip. Clamp
    //    to source and fail fast when nothing usable remains.
    const sourceDurationSec = await probeDurationSec(sourcePath);
    if (sourceDurationSec <= 0) {
      throw new Error("source video has no readable duration — bad container or empty download");
    }
    const startSec = Math.min(startMs / 1000, sourceDurationSec);
    const endSec = Math.min(endMs / 1000, sourceDurationSec);
    const spanSec = endSec - startSec;
    if (spanSec < MIN_CLIP_DURATION_SEC) {
      throw new Error(
        `Clip window (${(startMs / 1000).toFixed(1)}s–${(endMs / 1000).toFixed(1)}s) sits past the source video's ${sourceDurationSec.toFixed(1)}s duration. Only ${spanSec.toFixed(1)}s of usable footage. Pick an earlier moment or supply a longer source.`,
      );
    }

    // 3. Captions — slice to the effective (possibly-clamped) window.
    const localSrt = sliceSrt(captionsSrt, Math.round(startSec * 1000), Math.round(endSec * 1000));
    await writeFile(srtPath, localSrt, "utf8");

    // 4. Render
    await renderClipVideo({
      sourcePath,
      srtPath,
      outputPath: outPath,
      startSec,
      endSec,
      aspect,
    });

    // 5. Poster — best-effort. If ffmpeg can't extract a frame (very
    //    short clip, weird container, codec quirks), we still ship the
    //    MP4. The card just won't have a poster preview.
    let posterAvailable = false;
    try {
      await extractPoster(outPath, posterPath);
      posterAvailable = true;
    } catch (err) {
      console.warn(
        `[clip ${clipId}] poster extraction failed, continuing without poster:`,
        err instanceof Error ? err.message : err,
      );
    }

    // 6. Duration probe (rendered file may be shorter than the clamped
    //    window if the source ended mid-clip).
    const durationSec = await probeDurationSec(outPath);
    if (durationSec < MIN_CLIP_DURATION_SEC) {
      throw new Error(
        `Rendered clip is only ${durationSec.toFixed(2)}s — below the ${MIN_CLIP_DURATION_SEC}s minimum. Source likely doesn't cover the requested window.`,
      );
    }

    // 7. Upload — poster only if it was actually produced.
    const prefix = outputPrefix.replace(/\/$/, "");
    const clipUpload = await uploadFile(outPath, `${prefix}/clip.mp4`, "video/mp4");
    const posterUpload = posterAvailable
      ? await uploadFile(posterPath, `${prefix}/poster.jpg`, "image/jpeg")
      : null;

    // The SRT itself isn't returned to the app, but we upload it so the
    // trim editor can re-render without recomputing captions.
    await uploadFile(srtPath, `${prefix}/captions.srt`, "application/x-subrip");

    return {
      clipId,
      renderedUrl: clipUpload.url,
      posterUrl: posterUpload?.url ?? "",
      durationMs: Math.round(durationSec * 1000),
      bytes: clipUpload.bytes,
    };
  } finally {
    // Always clean up — a failed render can leave a 500 MB source file
    // behind, and this VPS only has 72 GB of disk.
    await rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}
