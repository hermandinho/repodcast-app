import { execa } from "execa";

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

  // The subtitles filter takes a path; escape single quotes for the filter
  // parser. Font styling matches worker/Dockerfile's `ttf-dejavu` package.
  //
  // `original_size` tells libass what canvas the ASS defaults are meant
  // for. Without it, libass assumes 384×288 and scales font/margins up to
  // fit our 1080-wide output — captions balloon and run off-screen.
  // MarginL/MarginR force wrap into the visible frame; WrapStyle=0 =
  // smart wrap.
  const srtEscaped = srtPath.replace(/'/g, "\\'").replace(/:/g, "\\:");
  const captionStyle = [
    "Fontname=DejaVu Sans",
    "FontSize=24",
    "PrimaryColour=&H00FFFFFF&",
    "OutlineColour=&H00000000&",
    "BackColour=&H80000000&",
    "BorderStyle=3", // opaque box behind text for readability on any background
    "Outline=2",
    "Shadow=0",
    "Alignment=2",
    "MarginL=60",
    "MarginR=60",
    `MarginV=${Math.round(dims.h * 0.06)}`,
    "WrapStyle=0",
    "Bold=1",
  ].join(",");
  const filter =
    `${dims.cropFilter},scale=${dims.w}:${dims.h},` +
    `subtitles='${srtEscaped}':original_size=${dims.w}x${dims.h}:force_style='${captionStyle}'`;

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
 * Extract a single frame from `videoPath` as a JPEG. Uses ~1 s in to skip
 * any black lead-in frame that ffmpeg's re-encode sometimes emits at t=0.
 */
export async function extractPoster(videoPath: string, outputPath: string): Promise<void> {
  await execa(
    "ffmpeg",
    [
      "-y",
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      "1",
      "-i",
      videoPath,
      "-vframes",
      "1",
      "-q:v",
      "2",
      outputPath,
    ],
    { timeout: 60_000 },
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
