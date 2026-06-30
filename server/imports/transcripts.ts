import "server-only";

/**
 * Phase 2.8 — fetch + flatten a publisher-supplied transcript file.
 *
 * Podcast Index exposes transcripts as VTT, SRT, plain text, or JSON
 * (Podcasting 2.0 spec). Our LLM consumer wants prose — speaker labels
 * and paragraph breaks help, but cue timestamps and HTML entities are
 * just noise. This module fetches the file, sniffs the format, and
 * returns clean text.
 */

const FETCH_TIMEOUT_MS = 15_000;

export class TranscriptFetchError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "TranscriptFetchError";
    this.status = status;
  }
}

/**
 * Fetch a transcript URL with a hard timeout, then normalise based on
 * content type (or URL extension fallback when the server omits the
 * header). Returns the cleaned text or null when the response is empty
 * after normalisation.
 */
export async function fetchAndNormaliseTranscript(
  url: string,
  declaredType?: string,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new TranscriptFetchError(
      `Transcript fetch returned ${res.status} ${res.statusText}`,
      res.status,
    );
  }
  const body = await res.text();
  const contentType = res.headers.get("content-type") ?? declaredType ?? "";
  const normalised = normaliseTranscript(body, contentType, url);
  return normalised.trim().length === 0 ? null : normalised;
}

/**
 * Convert a raw transcript blob to plain prose. Exported for tests.
 *
 * Strategy:
 *  - JSON (Podcasting 2.0): segments with `body` (and optional `speaker`)
 *    — render `Speaker: body` per turn, collapsing runs from the same
 *    speaker.
 *  - VTT / SRT: strip cue timing lines + ordinal numbers, keep the text.
 *  - HTML: strip tags + decode the few entities that actually show up.
 *  - Plain text: just trim trailing whitespace per line.
 */
export function normaliseTranscript(body: string, contentType: string, url: string): string {
  const lowerType = contentType.toLowerCase();
  const lowerUrl = url.toLowerCase();

  if (lowerType.includes("json") || lowerUrl.endsWith(".json")) {
    return normaliseJson(body);
  }
  if (lowerType.includes("vtt") || lowerUrl.endsWith(".vtt")) {
    return normaliseVtt(body);
  }
  if (lowerType.includes("srt") || lowerUrl.endsWith(".srt")) {
    return normaliseSrt(body);
  }
  if (lowerType.includes("html") || lowerUrl.endsWith(".html") || lowerUrl.endsWith(".htm")) {
    return stripHtml(body);
  }
  // Plain text fallthrough — keep line breaks, collapse trailing whitespace.
  return body.replace(/[ \t]+$/gm, "").trim();
}

type JsonSegment = {
  speaker?: unknown;
  body?: unknown;
  text?: unknown;
};

type JsonTranscript = {
  segments?: JsonSegment[];
  version?: string;
};

function normaliseJson(body: string): string {
  let parsed: JsonTranscript;
  try {
    parsed = JSON.parse(body) as JsonTranscript;
  } catch {
    return body.trim();
  }
  const segments = parsed.segments ?? [];
  if (segments.length === 0) return "";

  const lines: string[] = [];
  let currentSpeaker: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const label = currentSpeaker ? `${currentSpeaker}: ` : "";
    lines.push(`${label}${buffer.join(" ")}`);
    buffer = [];
  };

  for (const seg of segments) {
    const text =
      typeof seg.body === "string" ? seg.body : typeof seg.text === "string" ? seg.text : "";
    if (!text.trim()) continue;
    const speaker =
      typeof seg.speaker === "string" && seg.speaker.trim().length > 0 ? seg.speaker.trim() : null;
    if (speaker !== currentSpeaker) {
      flush();
      currentSpeaker = speaker;
    }
    buffer.push(text.trim());
  }
  flush();
  return lines.join("\n\n");
}

const VTT_TIMING = /^\d{1,2}:\d{2}(?::\d{2})?\.\d{3}\s+-->/;
const SRT_TIMING = /^\d{1,2}:\d{2}:\d{2},\d{3}\s+-->/;
const ORDINAL_LINE = /^\d+$/;

function normaliseVtt(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let inHeader = true;
  for (const raw of lines) {
    const line = raw.trim();
    if (inHeader) {
      // Skip the leading "WEBVTT" line + any header metadata until the
      // first blank line that introduces cues.
      if (line.startsWith("WEBVTT")) continue;
      if (line.length === 0) {
        inHeader = false;
        continue;
      }
      continue;
    }
    if (line.length === 0) {
      // Blank line between cues — paragraph break in the output.
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (VTT_TIMING.test(line)) continue;
    if (ORDINAL_LINE.test(line)) continue;
    // Strip inline `<v Speaker>` markup → "Speaker: ".
    const withSpeaker = line.replace(/<v\s+([^>]+)>/g, "$1: ").replace(/<\/v>/g, "");
    out.push(stripHtmlInline(withSpeaker));
  }
  return collapseBlankRuns(out).join("\n").trim();
}

function normaliseSrt(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (SRT_TIMING.test(line)) continue;
    if (ORDINAL_LINE.test(line)) continue;
    out.push(stripHtmlInline(line));
  }
  return collapseBlankRuns(out).join("\n").trim();
}

function stripHtml(body: string): string {
  // Replace block-level tags with newlines before stripping so paragraph
  // structure survives; then collapse runs of whitespace.
  const blockified = body
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n\n")
    .replace(/<br\s*\/?\s*>/gi, "\n");
  const stripped = blockified.replace(/<[^>]+>/g, "");
  return decodeEntities(stripped)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripHtmlInline(line: string): string {
  return decodeEntities(line.replace(/<[^>]+>/g, ""));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function collapseBlankRuns(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line === "" && out[out.length - 1] === "") continue;
    out.push(line);
  }
  return out;
}
