/**
 * SRT slicer. Takes an episode-wide SRT and rewrites it to be relative to
 * a clip window: entries fully outside the window are dropped, entries
 * that cross the window boundary are trimmed, and all timestamps are
 * rebased so 00:00:00,000 = clip start.
 *
 * SRT format (RFC-adjacent):
 *   1
 *   00:00:12,340 --> 00:00:15,780
 *   Some spoken text.
 *
 *   2
 *   00:00:16,020 --> 00:00:19,410
 *   More spoken text.
 */

const TIMECODE_RE = /^(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/;

type Entry = { startMs: number; endMs: number; text: string };

export function sliceSrt(srt: string, windowStartMs: number, windowEndMs: number): string {
  const entries = parseSrt(srt);
  const out: Entry[] = [];

  for (const e of entries) {
    // Entirely outside the window — skip.
    if (e.endMs <= windowStartMs || e.startMs >= windowEndMs) continue;

    // Clamp to window, then rebase to window-relative time.
    const start = Math.max(e.startMs, windowStartMs) - windowStartMs;
    const end = Math.min(e.endMs, windowEndMs) - windowStartMs;
    if (end <= start) continue;

    out.push({ startMs: start, endMs: end, text: e.text });
  }

  return renderSrt(out);
}

export function parseSrt(srt: string): Entry[] {
  const entries: Entry[] = [];
  // Normalize line endings, then split on blank lines.
  const blocks = srt
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n{2,}/);

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) continue;

    // First line is optional sequence number; timecode may be first or second.
    const timecodeLineIdx = TIMECODE_RE.test(lines[0]) ? 0 : 1;
    const match = TIMECODE_RE.exec(lines[timecodeLineIdx]);
    if (!match) continue;

    const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = match;
    const startMs = toMs(h1, m1, s1, ms1);
    const endMs = toMs(h2, m2, s2, ms2);
    if (endMs <= startMs) continue;

    const text = lines
      .slice(timecodeLineIdx + 1)
      .join("\n")
      .trim();
    if (!text) continue;

    entries.push({ startMs, endMs, text });
  }
  return entries;
}

function toMs(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600_000 + Number(m) * 60_000 + Number(s) * 1000 + Number(ms);
}

function formatTimecode(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const h = Math.floor(total / 3600_000);
  const m = Math.floor((total % 3600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${pad3(millis)}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
function pad3(n: number): string {
  return n.toString().padStart(3, "0");
}

function renderSrt(entries: Entry[]): string {
  return entries
    .map((e, i) => {
      const seq = i + 1;
      const start = formatTimecode(e.startMs);
      const end = formatTimecode(e.endMs);
      return `${seq}\n${start} --> ${end}\n${e.text}\n`;
    })
    .join("\n");
}
