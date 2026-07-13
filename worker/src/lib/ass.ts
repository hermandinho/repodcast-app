import { parseSrt } from "./srt.js";

/**
 * Q1 wk10 — SRT → ASS converter with embedded styles.
 *
 * Why not use ffmpeg's `subtitles=file.srt:force_style=…`?
 *   ffmpeg's filter-graph parser and libass have different views on
 *   quoting + escaping. Commas inside force_style get eaten by the
 *   graph parser on most builds; `\,` escapes work on some versions
 *   but not others; single quotes protect on some, not others.
 *   Result: our fonts/alignments/margins were being silently dropped
 *   in production, libass fell back to its defaults, and clip
 *   captions rendered center-center at 24 pt regardless of what we
 *   set in the code.
 *
 * The robust fix is to write a proper ASS file with the style in the
 * script header. `subtitles=file.ass` reads it verbatim — no
 * force_style, no quoting ambiguity, no parser to fight.
 */

export type AssStyle = {
  /** e.g. "DejaVu Sans" */
  fontName: string;
  /** ASS font size in the reference resolution's pixel units. */
  fontSize: number;
  /** Text color as &HAABBGGRR&; AA = 00 opaque. Default white. */
  primaryColor: string;
  /** Outline / border color. Default black. */
  outlineColor: string;
  /** Background box color (used when borderStyle=3). Default 60% black. */
  backColor: string;
  /**
   * 1 = outline + drop shadow only.
   * 3 = opaque box behind text (better legibility on busy footage).
   */
  borderStyle: 1 | 3;
  /** Outline / box padding thickness in reference-resolution pixels. */
  outline: number;
  /** Drop-shadow offset; 0 = no shadow. */
  shadow: number;
  /**
   * ASS numpad alignment:
   *   1 2 3 = bottom (L / C / R)
   *   4 5 6 = middle
   *   7 8 9 = top
   */
  alignment: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  marginL: number;
  marginR: number;
  marginV: number;
  bold: boolean;
  /**
   * 0 = smart wrap (prefer even lines).
   * 2 = no wrap (single line unless \N).
   */
  wrapStyle: 0 | 1 | 2 | 3;
  /** Canvas the styles are sized for. Match your render dimensions. */
  playResX: number;
  playResY: number;
};

/**
 * Convert a full SRT string to an ASS document with a Default style
 * populated from the given AssStyle. Timestamps are re-formatted from
 * SRT's `HH:MM:SS,mmm` to ASS's `H:MM:SS.cc`.
 */
export function srtStringToAss(srt: string, style: AssStyle): string {
  const entries = parseSrt(srt);

  const scriptInfo = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${style.playResX}`,
    `PlayResY: ${style.playResY}`,
    `WrapStyle: ${style.wrapStyle}`,
    "ScaledBorderAndShadow: yes",
    "",
  ].join("\n");

  const styleFormat =
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, " +
    "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, " +
    "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, " +
    "Alignment, MarginL, MarginR, MarginV, Encoding";

  // ASS boolean encoding: Bold uses -1 for true, 0 for false.
  const boldFlag = style.bold ? -1 : 0;

  const styleLine = [
    "Default",
    style.fontName,
    style.fontSize,
    style.primaryColor,
    "&H000000FF", // SecondaryColour (unused with our single-style setup)
    style.outlineColor,
    style.backColor,
    boldFlag,
    0, // Italic
    0, // Underline
    0, // StrikeOut
    100, // ScaleX
    100, // ScaleY
    0, // Spacing
    0, // Angle
    style.borderStyle,
    style.outline,
    style.shadow,
    style.alignment,
    style.marginL,
    style.marginR,
    style.marginV,
    1, // Encoding
  ].join(",");

  const styles = ["[V4+ Styles]", styleFormat, `Style: ${styleLine}`, ""].join("\n");

  const eventsFormat =
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text";
  const eventLines = entries.map((e) => {
    const start = formatAssTime(e.startMs);
    const end = formatAssTime(e.endMs);
    // ASS newlines inside a dialogue line are `\N`; commas inside text
    // are literal (only the Format fields have positional commas).
    const text = e.text.replace(/\r?\n/g, "\\N");
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
  });
  const events = ["[Events]", eventsFormat, ...eventLines, ""].join("\n");

  return [scriptInfo, styles, events].join("\n");
}

/** SRT ms → ASS `H:MM:SS.cc` (centiseconds). */
function formatAssTime(totalMs: number): string {
  const ms = Math.max(0, Math.floor(totalMs));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const cs = Math.floor((ms % 1000) / 10); // 0..99
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
}
