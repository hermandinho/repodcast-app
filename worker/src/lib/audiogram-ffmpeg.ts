import { execa } from "execa";

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

  // Escape the SRT path for the subtitles filter.
  const srtEscaped = srtPath.replace(/'/g, "\\'").replace(/:/g, "\\:");
  // libass has no idea about our target resolution when reading an SRT —
  // it defaults to a 384×288 PlayRes and scales the ASS default styles up
  // to whatever the video is. Result: 36 pt font becomes gigantic on a
  // 1080×1920 canvas. We pass `original_size` so libass renders at the
  // intended scale, then FontSize / MarginV / MarginL / MarginR are in
  // the units we actually mean.
  //
  // MarginL/MarginR force wrapping to fit the visible frame; without them
  // long lines run off the edges. WrapStyle=0 = smart wrap.
  // Alignment=5 = middle-center in ASS numpad notation. When the
  // alignment sits vertically in the middle, MarginV isn't used by
  // libass for positioning, so we drop it. Wrap is smart (WrapStyle=0)
  // + MarginL/R force horizontal fit within the frame.
  // Escape commas inside force_style — the ffmpeg filter-graph parser
  // treats bare `,` as a chain separator even inside `'…'`, so all keys
  // past the first were being silently dropped. See ffmpeg.ts for the
  // same fix on the clip renderer.
  const captionStyle = [
    "Fontname=DejaVu Sans",
    "FontSize=24",
    "PrimaryColour=&H00FFFFFF&",
    "OutlineColour=&H00000000&",
    "BackColour=&H80000000&",
    "BorderStyle=3", // opaque box behind text — improves legibility on busy backgrounds
    "Outline=2",
    "Shadow=0",
    "Alignment=5", // middle-center
    "MarginL=80",
    "MarginR=80",
    "MarginV=0",
    "WrapStyle=0",
    "Bold=1",
  ].join("\\,");

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
    `[bgwave]subtitles='${srtEscaped}':original_size=${w}x${h}:force_style=${captionStyle}[vout]`;

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
