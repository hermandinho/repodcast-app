import { readFile, writeFile } from "node:fs/promises";
import { execa } from "execa";
import { srtStringToAss } from "./ass.js";

/**
 * Q1 feature #5 — audiogram (waveform video) ffmpeg pipeline.
 *
 * Composition:
 *   Layer 0: solid dark background (or blurred artwork if bgImagePath is set)
 *   Layer 1: `showwaves` centered horizontally, spanning the middle band
 *   Layer 2: subtitles burned in from srtPath
 *
 * We use libavfilter's built-in `showwaves` filter — no external
 * visualiser needed. `mode=cline` gives centered vertical bars that
 * pulse with the audio. Color is white with 80% opacity for a
 * high-contrast, easy-to-read look on any background.
 *
 * All commands hard-timeout at 5 min to bound cost per render.
 */

export type AudiogramAspect = "1:1" | "9:16";

const OUTPUT_DIMS: Record<AudiogramAspect, { w: number; h: number }> = {
  "1:1": { w: 1080, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
};

/**
 * Render an audiogram MP4 from a trimmed audio window + optional
 * background image + burned-in captions.
 *
 * If `bgImagePath` is null, we render on a solid #0F1B2C background.
 * If it's set, we blur + darken the image and overlay the waveform.
 */
export async function renderAudiogramVideo(input: {
  audioPath: string;
  srtPath: string;
  bgImagePath: string | null;
  outputPath: string;
  startSec: number;
  endSec: number;
  aspect: AudiogramAspect;
}): Promise<void> {
  const { audioPath, srtPath, bgImagePath, outputPath, startSec, endSec, aspect } = input;
  const { w, h } = OUTPUT_DIMS[aspect];
  const durationSec = Math.max(1, endSec - startSec);

  // Waveform now sits in a bottom band so the caption can occupy the
  // visual centre without collision. Wave takes ~16 % of the frame,
  // anchored ~72 % down, leaving the middle ~40 % clear for the
  // centered caption block.
  const waveH = Math.round(h * 0.16);
  const waveY = Math.round(h * 0.72);

  // Convert the SRT to a proper ASS file with our styling baked into
  // the [V4+ Styles] block. See worker/src/lib/ass.ts for why we don't
  // trust ffmpeg's force_style anymore.
  const srtText = await readFile(srtPath, "utf8");
  const assPath = `${srtPath}.ass`;
  const assDocument = srtStringToAss(srtText, {
    fontName: "DejaVu Sans",
    fontSize: 52,
    primaryColor: "&H00FFFFFF",
    outlineColor: "&H00000000",
    backColor: "&H80000000",
    borderStyle: 3,
    outline: 8,
    shadow: 0,
    alignment: 5, // middle-center
    marginL: 100,
    marginR: 100,
    marginV: 0,
    bold: true,
    wrapStyle: 0,
    playResX: w,
    playResY: h,
  });
  await writeFile(assPath, assDocument, "utf8");
  const assEscaped = assPath.replace(/'/g, "\\'").replace(/:/g, "\\:");

  // Filter graph. The audio input gets its own trim so the whole file
  // isn't re-encoded; the waveform is generated from the trimmed audio.
  const bgFilter = bgImagePath
    ? // Blurred + darkened artwork
      `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,` +
      `crop=${w}:${h},boxblur=20:2,eq=brightness=-0.25[bg]`
    : // Solid color
      `color=c=#0F1B2C:s=${w}x${h}:d=${durationSec.toFixed(3)}[bg]`;

  const filter =
    `${bgFilter};` +
    `[1:a]atrim=${startSec.toFixed(3)}:${endSec.toFixed(3)},asetpts=PTS-STARTPTS[trimaudio];` +
    `[trimaudio]asplit=2[audio][audioWave];` +
    `[audioWave]showwaves=s=${w}x${waveH}:mode=cline:colors=white@0.9:rate=25[wave];` +
    `[bg][wave]overlay=0:${waveY}:shortest=1[bgwave];` +
    `[bgwave]subtitles='${assEscaped}'[vout]`;

  const inputs = bgImagePath
    ? ["-loop", "1", "-i", bgImagePath, "-i", audioPath]
    : ["-i", audioPath, "-i", audioPath]; // dummy first input for filter parity — showwaves doesn't need it

  // With no background, we skip the [0:v] input and generate `color` inside the graph.
  const finalInputs = bgImagePath ? inputs : ["-i", audioPath];
  const audioMapIdx = bgImagePath ? "1" : "0";
  const finalFilter = bgImagePath
    ? filter
    : filter
        // Rewrite the graph to source audio from input 0 instead of 1.
        .replace("[1:a]", `[${audioMapIdx}:a]`);

  await execa(
    "ffmpeg",
    [
      "-y",
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      ...finalInputs,
      "-filter_complex",
      finalFilter,
      "-map",
      "[vout]",
      "-map",
      "[audio]",
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
      "-t",
      durationSec.toFixed(3),
      "-movflags",
      "+faststart",
      "-pix_fmt",
      "yuv420p",
      outputPath,
    ],
    { timeout: 5 * 60_000 },
  );
}
