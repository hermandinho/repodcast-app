import { readFile, writeFile } from "node:fs/promises";
import { execa } from "execa";
import { srtStringToAss } from "./ass.js";

/**
 * Thin ffmpeg subprocess wrappers. All commands are hardcoded — no user
 * input flows unescaped into the argv (execa uses argv arrays, not shell
 * strings, so injection isn't a concern; the discipline is still worth it).
 *
 * Presets:
 *   - `libx264 -preset veryfast -crf 23` — quick renders, decent quality.
 *     A 60 s 9:16 clip on the OVH VPS (4 vCPU) lands in ~15–25 s.
 *   - AAC 128 kbps mono/stereo depending on source.
 *   - `+faststart` moves moov atom to the front so browsers can begin
 *     playback before the download finishes.
 */

export type Aspect = "9:16" | "1:1" | "16:9";

const OUTPUT_DIMS: Record<Aspect, { w: number; h: number; cropFilter: string }> = {
  "9:16": { w: 1080, h: 1920, cropFilter: "crop=ih*9/16:ih" },
  "1:1": { w: 1080, h: 1080, cropFilter: "crop=ih:ih" },
  "16:9": { w: 1920, h: 1080, cropFilter: "crop=iw:iw*9/16" },
};

/**
 * Cut a range from `sourcePath`, crop/scale to the target aspect ratio,
 * burn in captions from `srtPath`. Writes to `outputPath` (MP4, H.264+AAC).
 *
 * `-ss` before `-i` gets fast keyframe-aligned seek. Modern ffmpeg (6.x+)
 * refines the seek during decode when re-encoding is on, so accuracy is
 * within one frame — good enough for social clips.
 */
export async function renderClipVideo(input: {
  sourcePath: string;
  srtPath: string;
  outputPath: string;
  startSec: number;
  endSec: number;
  aspect: Aspect;
}): Promise<void> {
  const { sourcePath, srtPath, outputPath, startSec, endSec, aspect } = input;
  const dims = OUTPUT_DIMS[aspect];

  // Convert the SRT to a proper ASS file with our style baked in —
  // bypasses ffmpeg's force_style quoting/escaping issues entirely.
  // See worker/src/lib/ass.ts for the rationale.
  //
  // Clips (video content) use bottom-anchored captions like every
  // social video platform — center-center covers the talking head.
  // Font is smaller than audiograms since a clip has its own visual
  // content competing with the caption for attention. MarginV is a
  // % of frame height so captions sit above safe-area.
  const srtText = await readFile(srtPath, "utf8");
  const assPath = `${srtPath}.ass`;
  const ass = srtStringToAss(srtText, {
    fontName: "DejaVu Sans",
    fontSize: 42,
    primaryColor: "&H00FFFFFF",
    outlineColor: "&H00000000",
    backColor: "&HA0000000",
    borderStyle: 3,
    outline: 6,
    shadow: 0,
    alignment: 2, // bottom-center
    marginL: 60,
    marginR: 60,
    marginV: Math.round(dims.h * 0.08),
    bold: true,
    wrapStyle: 0,
    playResX: dims.w,
    playResY: dims.h,
  });
  await writeFile(assPath, ass, "utf8");

  const assEscaped = assPath.replace(/'/g, "\\'").replace(/:/g, "\\:");
  const filter = `${dims.cropFilter},scale=${dims.w}:${dims.h},subtitles='${assEscaped}'`;

  await execa(
    "ffmpeg",
    [
      "-y",
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      startSec.toFixed(3),
      "-to",
      endSec.toFixed(3),
      "-i",
      sourcePath,
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-pix_fmt",
      "yuv420p", // Safari + iOS compatibility
      outputPath,
    ],
    { timeout: 5 * 60_000 }, // 5 min hard cap per render
  );
}

/**
 * Extract a single frame from `videoPath` as a JPEG.
 *
 * Three-pass strategy for resilience against short / weird clips:
 *   1. Output-side seek to 0.5 s + explicit image2 muxer.
 *   2. First frame with explicit image2 muxer.
 *   3. First frame with vframes syntax (older ffmpeg fallback).
 *
 * If all three fail, the caller catches — poster extraction is nice-to-
 * have; a clip with a missing poster is still a valid deliverable.
 *
 * ffmpeg's exit codes travel back through execa as `err.exitCode`; we
 * surface the stderr with the throw so the caller can log it.
 */
export async function extractPoster(videoPath: string, outputPath: string): Promise<void> {
  const baseArgs = ["-y", "-nostdin", "-hide_banner", "-loglevel", "info", "-i", videoPath];

  const attempts: string[][] = [
    [...baseArgs, "-ss", "0.5", "-frames:v", "1", "-q:v", "2", "-f", "image2", outputPath],
    [...baseArgs, "-frames:v", "1", "-q:v", "2", "-f", "image2", outputPath],
    [...baseArgs, "-vframes", "1", "-q:v", "2", outputPath],
  ];

  let lastError: unknown = null;
  for (const args of attempts) {
    try {
      await execa("ffmpeg", args, { timeout: 60_000 });
      return;
    } catch (err) {
      lastError = err;
    }
  }
  // Include stderr in the surfaced message so the worker's caller
  // (Inngest) can log the real cause, not just a bare exit code.
  const stderr =
    lastError && typeof lastError === "object" && "stderr" in lastError
      ? String((lastError as { stderr: unknown }).stderr).slice(0, 800)
      : "";
  throw new Error(
    `poster extraction failed after 3 attempts. Last stderr: ${stderr || "(no stderr)"}`,
  );
}

/**
 * Probe a file's duration. Used to double-check clip length after render
 * so the worker can report a truthful durationMs even if ffmpeg trimmed
 * differently than requested (e.g. source shorter than expected).
 */
export async function probeDurationSec(path: string): Promise<number> {
  const { stdout } = await execa(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      path,
    ],
    { timeout: 30_000 },
  );
  const parsed = Number.parseFloat(stdout.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}
