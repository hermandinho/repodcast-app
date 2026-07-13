import "server-only";

import type { DeepgramWord } from "../transcription/deepgram";
import { CLAUDE_MODEL, requireClaudeClient } from "./claude";
import { extractText } from "./prompt-builder";

/**
 * Q1 wk2 — pick top-N vertical-clip candidates from a transcript.
 *
 * Input is Deepgram's word list (per-word start/end in seconds). We compress
 * it to a lightly-timestamped transcript ("[MM:SS] utterance") to keep the
 * prompt small — a 60-min episode is ~9000 words, so we mark every ~50
 * words or ~15 s (whichever comes first) instead of one marker per word.
 *
 * Output is validated in three passes before it reaches VideoClip rows:
 *   1. JSON parse (mirrors key-moments.ts — permissive to code fences).
 *   2. Length window — 15 s ≤ span ≤ 90 s. Rejects Claude occasionally
 *      returning a whole-episode summary "clip" or a two-word soundbite.
 *   3. Non-overlap — sorted by descending score, later spans that overlap
 *      an already-kept span are dropped. Keeps the top pick when Claude
 *      returns two takes on the same moment.
 *   4. Snap — start/end are moved to the nearest word boundary so the
 *      ffmpeg trim starts/ends on a natural pause.
 *
 * Not using Anthropic tool-use — key-moments.ts sets the codebase-wide
 * pattern of "JSON in prose, parse loosely" and consistency is more
 * valuable than strict schemas at this size. Switch if parse failures
 * become a signal.
 */

export type HighlightCandidate = {
  /** Millisecond boundaries, snapped to Deepgram word boundaries. */
  startMs: number;
  endMs: number;
  /** Model-assigned 0..1 score. Higher = stronger hook + more standalone. */
  score: number;
  /** One-sentence pitch from the model — why this moment is a clip. */
  hookLine: string;
};

const DEFAULT_MAX_CLIPS = 5;
const MAX_CLIPS_CEILING = 10;
const MIN_SPAN_SEC = 15;
const MAX_SPAN_SEC = 90;
const MARKER_EVERY_N_WORDS = 50;
const MARKER_EVERY_SEC = 15;

const SYSTEM_PROMPT = `You pick the strongest short-form clip candidates from podcast transcripts.

Each candidate must be:
- STANDALONE — makes sense to a viewer with no context. A punchy claim,
  crisp anecdote, or specific rule — not "as I was saying earlier".
- LENGTH-VALID — between 25 and 75 seconds of speech. Shorter than 25s
  and there's no time to land the point; longer than 75s and it won't
  survive the Reels/TikTok/Shorts scroll.
- HOOK-FIRST — opens with something that stops a scroll: a strong claim,
  a specific number, a contrarian take, or a vivid metaphor. Not
  "so I was just thinking...".
- DISTINCT — do not return two clips that make the same point in
  different words. Pick the punchier version and move on.
- EMOTIONALLY LOADED — surprise, disagreement, hard-won lesson, dark
  humor. Neutral definitional passages are boring on video.

For each candidate, return:
- "startTs" — start timestamp in "MM:SS" or "HH:MM:SS" format.
- "endTs"   — end timestamp in the same format.
- "score"   — float in [0, 1]. 1 = clear scroll-stopper. 0.5 = decent. Below
              0.4 = don't return it.
- "hookLine" — one sentence (<= 25 words) pitching why this moment works.
              Written for a reviewer scanning a card, not a caption.

Respond with ONLY a JSON array of these objects. No prose, no markdown
fences, no preamble. If the transcript is too short or contains no
usable material, return "[]".`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function selectHighlights(input: {
  episodeTitle: string;
  words: DeepgramWord[];
  maxClips?: number;
}): Promise<HighlightCandidate[]> {
  const { episodeTitle, words } = input;
  const maxClips = Math.min(Math.max(input.maxClips ?? DEFAULT_MAX_CLIPS, 1), MAX_CLIPS_CEILING);

  if (words.length === 0) return [];

  const client = requireClaudeClient();
  const transcript = buildTimestampedTranscript(words);

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content:
          `Episode: ${episodeTitle}\n` +
          `Return up to ${maxClips} candidates, ordered by score (highest first).\n\n` +
          `Transcript with timestamps every ~15 s:\n\n${transcript}\n\n` +
          `Return the JSON array now.`,
      },
    ],
  });

  const raw = parseHighlights(extractText(response));
  return finalizeCandidates(raw, words, maxClips);
}

// ---------------------------------------------------------------------------
// Timestamped transcript
// ---------------------------------------------------------------------------

/**
 * Convert a Deepgram word list into a lightly-timestamped transcript.
 * Inserts a `[MM:SS]` (or `[HH:MM:SS]` if long enough) marker at the start
 * and whenever we've walked past `MARKER_EVERY_N_WORDS` words OR
 * `MARKER_EVERY_SEC` seconds since the last marker.
 *
 * Exported for tests.
 */
export function buildTimestampedTranscript(words: DeepgramWord[]): string {
  if (words.length === 0) return "";

  const parts: string[] = [];
  let wordsSinceMarker = 0;
  let secondsSinceMarker = 0;
  let lastMarkerAt = -Infinity;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const needsMarker =
      i === 0 || wordsSinceMarker >= MARKER_EVERY_N_WORDS || secondsSinceMarker >= MARKER_EVERY_SEC;

    if (needsMarker) {
      parts.push(`\n[${formatTimestamp(w.start)}]`);
      wordsSinceMarker = 0;
      secondsSinceMarker = 0;
      lastMarkerAt = w.start;
    }

    parts.push(w.punctuated_word ?? w.word);
    wordsSinceMarker += 1;
    secondsSinceMarker = w.start - lastMarkerAt;
  }
  return parts.join(" ").trim();
}

/** `"12:34"` for < 1h, `"1:02:34"` for longer. */
export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}

/**
 * Convert a Deepgram word list to SRT the render worker can burn in.
 * Groups consecutive words into subtitle lines targeting `~maxCharsPerLine`
 * characters and `~maxSecPerLine` seconds, whichever hits first. Long
 * gaps between words (>0.7 s pause) also force a new line.
 *
 * Timestamps are absolute (episode-relative). The worker's `sliceSrt`
 * then trims + rebases to clip-local time.
 */
export function wordsToSrt(
  words: DeepgramWord[],
  opts?: { maxCharsPerLine?: number; maxSecPerLine?: number; maxGapSec?: number },
): string {
  const maxChars = opts?.maxCharsPerLine ?? 40;
  const maxSec = opts?.maxSecPerLine ?? 5;
  const maxGap = opts?.maxGapSec ?? 0.7;

  if (words.length === 0) return "";

  type Line = { startSec: number; endSec: number; text: string };
  const lines: Line[] = [];

  let currentText = "";
  let currentStart = words[0].start;
  let currentEnd = words[0].end;
  let prevEnd = -Infinity;

  const flush = () => {
    const trimmed = currentText.trim();
    if (trimmed.length === 0) return;
    lines.push({ startSec: currentStart, endSec: currentEnd, text: trimmed });
    currentText = "";
  };

  for (const w of words) {
    const token = w.punctuated_word ?? w.word;
    const gap = w.start - prevEnd;
    const wouldExceedChars =
      currentText.length > 0 && currentText.length + token.length + 1 > maxChars;
    const wouldExceedTime = currentText.length > 0 && w.end - currentStart > maxSec;
    const bigPause = currentText.length > 0 && gap > maxGap;

    if (wouldExceedChars || wouldExceedTime || bigPause) {
      flush();
    }

    if (currentText.length === 0) {
      currentStart = w.start;
    }
    currentText = currentText.length === 0 ? token : `${currentText} ${token}`;
    currentEnd = w.end;
    prevEnd = w.end;
  }
  flush();

  return lines
    .map((line, i) => {
      const seq = i + 1;
      const start = formatSrtTimecode(line.startSec);
      const end = formatSrtTimecode(line.endSec);
      return `${seq}\n${start} --> ${end}\n${line.text}\n`;
    })
    .join("\n");
}

function formatSrtTimecode(seconds: number): string {
  const totalMs = Math.max(0, Math.floor(seconds * 1000));
  const h = Math.floor(totalMs / 3600_000);
  const m = Math.floor((totalMs % 3600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  const pad3 = (n: number) => n.toString().padStart(3, "0");
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(ms)}`;
}

/** Parses `MM:SS`, `M:SS`, `HH:MM:SS`, `H:MM:SS`. Returns null on garbage. */
export function parseTimestamp(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d{1,2}:\d{2}(:\d{2})?$/.test(trimmed)) return null;
  const parts = trimmed.split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

// ---------------------------------------------------------------------------
// Parsing (mirrors key-moments.ts's forgiving strategy)
// ---------------------------------------------------------------------------

type RawHighlight = {
  startTs?: unknown;
  endTs?: unknown;
  score?: unknown;
  hookLine?: unknown;
};

/**
 * Pull the JSON array out of a model response. Exposed for tests.
 * Returns raw shape — validation happens in `finalizeCandidates`.
 */
export function parseHighlights(text: string): RawHighlight[] {
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  const trimmed = text.trim();
  const direct = tryParse(trimmed);
  if (Array.isArray(direct)) return direct as RawHighlight[];

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    const inner = tryParse(fence[1].trim());
    if (Array.isArray(inner)) return inner as RawHighlight[];
  }

  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start !== -1 && end > start) {
    const slice = tryParse(trimmed.slice(start, end + 1));
    if (Array.isArray(slice)) return slice as RawHighlight[];
  }

  throw new Error(`Could not parse highlights from model response. Got:\n${trimmed.slice(0, 400)}`);
}

// ---------------------------------------------------------------------------
// Validation + snap
// ---------------------------------------------------------------------------

/** Exposed for tests. */
export function finalizeCandidates(
  raw: RawHighlight[],
  words: DeepgramWord[],
  maxClips: number,
): HighlightCandidate[] {
  if (words.length === 0) return [];

  const audioEndSec = words[words.length - 1].end;

  const parsed: HighlightCandidate[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const startSec = typeof item.startTs === "string" ? parseTimestamp(item.startTs) : null;
    const endSec = typeof item.endTs === "string" ? parseTimestamp(item.endTs) : null;
    const score = typeof item.score === "number" ? item.score : null;
    const hookLine = typeof item.hookLine === "string" ? item.hookLine.trim() : "";

    if (startSec === null || endSec === null || score === null) continue;
    if (hookLine.length === 0) continue;
    if (score < 0 || score > 1) continue;

    // Clamp to audio bounds — Claude sometimes hallucinates times past the end.
    const clampedStart = Math.max(0, Math.min(startSec, audioEndSec));
    const clampedEnd = Math.max(0, Math.min(endSec, audioEndSec));
    if (clampedEnd <= clampedStart) continue;

    const spanSec = clampedEnd - clampedStart;
    if (spanSec < MIN_SPAN_SEC || spanSec > MAX_SPAN_SEC) continue;

    // Snap to nearest word boundary — cleaner cuts in ffmpeg.
    const snappedStart = snapToWord(clampedStart, words, "start");
    const snappedEnd = snapToWord(clampedEnd, words, "end");
    if (snappedEnd - snappedStart < MIN_SPAN_SEC) continue;

    parsed.push({
      startMs: Math.round(snappedStart * 1000),
      endMs: Math.round(snappedEnd * 1000),
      score,
      hookLine,
    });
  }

  // Drop later overlappers — keep the higher-scored one when two collide.
  parsed.sort((a, b) => b.score - a.score);
  const kept: HighlightCandidate[] = [];
  for (const c of parsed) {
    if (kept.some((k) => overlaps(k, c))) continue;
    kept.push(c);
    if (kept.length >= maxClips) break;
  }

  // Return in temporal order — makes the UI list easier to scan.
  return kept.sort((a, b) => a.startMs - b.startMs);
}

function overlaps(a: HighlightCandidate, b: HighlightCandidate): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

/**
 * Move a target time to the closest word boundary. `mode = "start"` picks
 * the nearest word.start (so we don't clip mid-word); `mode = "end"` picks
 * the nearest word.end (so the clip trailing edge lands on a natural pause).
 */
function snapToWord(targetSec: number, words: DeepgramWord[], mode: "start" | "end"): number {
  let best = targetSec;
  let bestDelta = Infinity;
  for (const w of words) {
    const candidate = mode === "start" ? w.start : w.end;
    const delta = Math.abs(candidate - targetSec);
    if (delta < bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
    // words are sorted, so once we've walked past target by more than
    // 1s we can bail — nothing further will be closer.
    if (candidate > targetSec + 1) break;
  }
  return best;
}
