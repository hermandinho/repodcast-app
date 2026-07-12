import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractPoster, probeDurationSec, renderClipVideo, type Aspect } from "../lib/ffmpeg.js";
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

    // 2. Captions — slice to window, then re-baseline to clip-local time.
    const localSrt = sliceSrt(captionsSrt, startMs, endMs);
    await writeFile(srtPath, localSrt, "utf8");

    // 3. Render — ffmpeg trim + crop + burn
    await renderClipVideo({
      sourcePath,
      srtPath,
      outputPath: outPath,
      startSec: startMs / 1000,
      endSec: endMs / 1000,
      aspect,
    });

    // 4. Poster
    await extractPoster(outPath, posterPath);

    // 5. Duration probe (source might have been shorter than requested)
    const durationSec = await probeDurationSec(outPath);

    // 6. Upload
    const prefix = outputPrefix.replace(/\/$/, "");
    const [clipUpload, posterUpload] = await Promise.all([
      uploadFile(outPath, `${prefix}/clip.mp4`, "video/mp4"),
      uploadFile(posterPath, `${prefix}/poster.jpg`, "image/jpeg"),
    ]);

    // The SRT itself isn't returned to the app, but we upload it so the
    // trim editor can re-render without recomputing captions from Deepgram.
    await uploadFile(srtPath, `${prefix}/captions.srt`, "application/x-subrip");

    return {
      clipId,
      renderedUrl: clipUpload.url,
      posterUrl: posterUpload.url,
      durationMs: Math.round(durationSec * 1000),
      bytes: clipUpload.bytes,
    };
  } finally {
    // Always clean up — a failed render can leave a 500 MB source file
    // behind, and this VPS only has 72 GB of disk.
    await rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}
