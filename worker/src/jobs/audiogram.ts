import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderAudiogramVideo, type AudiogramAspect } from "../lib/audiogram-ffmpeg.js";
import { extractPoster, probeDurationSec } from "../lib/ffmpeg.js";
import { uploadFile } from "../lib/r2.js";
import { downloadSource } from "../lib/source.js";
import { sliceSrt } from "../lib/srt.js";

/**
 * Q1 feature #5 — audiogram render pipeline. Called per-request from
 * POST /render/audiogram.
 *
 * Steps:
 *   1. Scratch dir at /tmp/render/audiogram-{outputId}-{timestamp}/.
 *   2. Download audio (plain fetch — audioUrl is an R2 presign).
 *   3. Download background image if provided (show artwork).
 *   4. Slice + rebase SRT to [startMs, endMs].
 *   5. ffmpeg showwaves + background + captions → MP4.
 *   6. Extract poster at ~1s in.
 *   7. Upload MP4 + JPEG to R2 under outputPrefix.
 *   8. Delete scratch dir on both success and failure.
 */

export type AudiogramJobInput = {
  outputId: string;
  audioUrl: string;
  startMs: number;
  endMs: number;
  captionsSrt: string;
  aspect: AudiogramAspect;
  /** Show artwork URL — used as a blurred background. Null = solid color. */
  backgroundImageUrl: string | null;
  outputPrefix: string;
};

export type AudiogramJobOutput = {
  outputId: string;
  renderedUrl: string;
  posterUrl: string;
  durationMs: number;
  bytes: number;
};

const WORK_ROOT = process.env.WORK_DIR ?? tmpdir();

export async function renderAudiogram(input: AudiogramJobInput): Promise<AudiogramJobOutput> {
  const {
    outputId,
    audioUrl,
    startMs,
    endMs,
    captionsSrt,
    aspect,
    backgroundImageUrl,
    outputPrefix,
  } = input;

  const jobDir = join(WORK_ROOT, `audiogram-${outputId}-${Date.now()}`);
  const audioPath = join(jobDir, "audio.mp3");
  const bgPath = backgroundImageUrl ? join(jobDir, "bg.jpg") : null;
  const srtPath = join(jobDir, "captions.srt");
  const outPath = join(jobDir, "audiogram.mp4");
  const posterPath = join(jobDir, "poster.jpg");

  await mkdir(jobDir, { recursive: true });

  try {
    // 1. Audio
    await downloadSource(audioUrl, audioPath);

    // 2. Background (best-effort — fall back to solid color if this fails)
    let usableBgPath: string | null = null;
    if (bgPath && backgroundImageUrl) {
      try {
        await downloadSource(backgroundImageUrl, bgPath);
        usableBgPath = bgPath;
      } catch {
        // Non-fatal — the audiogram will render on solid color.
      }
    }

    // 3. Captions
    const localSrt = sliceSrt(captionsSrt, startMs, endMs);
    await writeFile(srtPath, localSrt, "utf8");

    // 4. Render
    await renderAudiogramVideo({
      audioPath,
      srtPath,
      bgImagePath: usableBgPath,
      outputPath: outPath,
      startSec: startMs / 1000,
      endSec: endMs / 1000,
      aspect,
    });

    // 5. Poster
    await extractPoster(outPath, posterPath);

    // 6. Duration
    const durationSec = await probeDurationSec(outPath);

    // 7. Upload
    const prefix = outputPrefix.replace(/\/$/, "");
    const [audiogramUpload, posterUpload] = await Promise.all([
      uploadFile(outPath, `${prefix}/audiogram.mp4`, "video/mp4"),
      uploadFile(posterPath, `${prefix}/poster.jpg`, "image/jpeg"),
    ]);
    await uploadFile(srtPath, `${prefix}/captions.srt`, "application/x-subrip");

    return {
      outputId,
      renderedUrl: audiogramUpload.url,
      posterUrl: posterUpload.url,
      durationMs: Math.round(durationSec * 1000),
      bytes: audiogramUpload.bytes,
    };
  } finally {
    await rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}
