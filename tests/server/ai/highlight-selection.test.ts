import { describe, expect, it } from "vitest";
import type { DeepgramWord } from "@/server/transcription/deepgram";
import {
  buildTimestampedTranscript,
  finalizeCandidates,
  formatTimestamp,
  parseHighlights,
  parseTimestamp,
} from "@/server/ai/highlight-selection";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Build a synthetic Deepgram word list of `count` words, one per 0.5 s. */
function makeWords(count: number, opts?: { startAt?: number }): DeepgramWord[] {
  const startAt = opts?.startAt ?? 0;
  return Array.from({ length: count }, (_, i) => ({
    word: `word${i}`,
    punctuated_word: `Word${i}`,
    start: startAt + i * 0.5,
    end: startAt + i * 0.5 + 0.4,
  }));
}

describe("formatTimestamp", () => {
  it("formats short durations as MM:SS", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(45)).toBe("0:45");
    expect(formatTimestamp(75)).toBe("1:15");
  });

  it("switches to HH:MM:SS past one hour", () => {
    expect(formatTimestamp(3600)).toBe("1:00:00");
    expect(formatTimestamp(3725)).toBe("1:02:05");
  });

  it("floors sub-second input", () => {
    expect(formatTimestamp(59.9)).toBe("0:59");
  });

  it("clamps negatives to zero", () => {
    expect(formatTimestamp(-10)).toBe("0:00");
  });
});

describe("parseTimestamp", () => {
  it("parses MM:SS and M:SS", () => {
    expect(parseTimestamp("1:15")).toBe(75);
    expect(parseTimestamp("12:34")).toBe(754);
  });

  it("parses HH:MM:SS", () => {
    expect(parseTimestamp("1:02:05")).toBe(3725);
  });

  it("returns null on garbage", () => {
    expect(parseTimestamp("garbage")).toBeNull();
    expect(parseTimestamp("1:2")).toBeNull(); // seconds must be 2-digit
    expect(parseTimestamp("")).toBeNull();
  });

  it("trims whitespace", () => {
    expect(parseTimestamp("  0:30  ")).toBe(30);
  });
});

describe("buildTimestampedTranscript", () => {
  it("returns empty string for empty word list", () => {
    expect(buildTimestampedTranscript([])).toBe("");
  });

  it("prefixes the transcript with a leading timestamp", () => {
    const t = buildTimestampedTranscript(makeWords(3));
    expect(t.startsWith("[0:00]")).toBe(true);
  });

  it("inserts a fresh marker every ~15 s of audio", () => {
    // 50 words at 0.5s each spans 25s → should get at least 2 markers.
    const t = buildTimestampedTranscript(makeWords(50));
    const markerCount = (t.match(/\[\d+:\d{2}\]/g) ?? []).length;
    expect(markerCount).toBeGreaterThanOrEqual(2);
  });

  it("uses punctuated_word when available", () => {
    const t = buildTimestampedTranscript(makeWords(2));
    expect(t).toContain("Word0");
    expect(t).toContain("Word1");
  });
});

describe("parseHighlights", () => {
  const VALID = JSON.stringify([
    { startTs: "0:10", endTs: "0:45", score: 0.9, hookLine: "The hook" },
    { startTs: "1:00", endTs: "1:50", score: 0.7, hookLine: "Second hook" },
  ]);

  it("parses clean JSON", () => {
    expect(parseHighlights(VALID)).toHaveLength(2);
  });

  it("strips ```json fences", () => {
    expect(parseHighlights("```json\n" + VALID + "\n```")).toHaveLength(2);
  });

  it("strips plain ``` fences", () => {
    expect(parseHighlights("```\n" + VALID + "\n```")).toHaveLength(2);
  });

  it("recovers from surrounding prose", () => {
    const sloppy = "Here you go:\n\n" + VALID + "\n\nEnjoy.";
    expect(parseHighlights(sloppy)).toHaveLength(2);
  });

  it("throws when no JSON is found", () => {
    expect(() => parseHighlights("no json here")).toThrow(/Could not parse highlights/);
  });

  it("returns empty array for '[]'", () => {
    expect(parseHighlights("[]")).toEqual([]);
  });
});

describe("finalizeCandidates", () => {
  const words = makeWords(400); // 200 s of audio

  it("returns [] when word list is empty", () => {
    expect(
      finalizeCandidates([{ startTs: "0:00", endTs: "0:30", score: 0.9, hookLine: "hi" }], [], 5),
    ).toEqual([]);
  });

  it("keeps a valid candidate and returns ms boundaries", () => {
    const out = finalizeCandidates(
      [{ startTs: "0:10", endTs: "0:40", score: 0.9, hookLine: "The hook" }],
      words,
      5,
    );
    expect(out).toHaveLength(1);
    expect(out[0].startMs).toBeGreaterThanOrEqual(9500);
    expect(out[0].startMs).toBeLessThanOrEqual(10500);
    expect(out[0].endMs).toBeGreaterThanOrEqual(39500);
    expect(out[0].hookLine).toBe("The hook");
  });

  it("drops spans shorter than 15s", () => {
    const out = finalizeCandidates(
      [{ startTs: "0:10", endTs: "0:20", score: 0.9, hookLine: "too short" }],
      words,
      5,
    );
    expect(out).toEqual([]);
  });

  it("drops spans longer than 90s", () => {
    const out = finalizeCandidates(
      [{ startTs: "0:00", endTs: "1:35", score: 0.9, hookLine: "too long" }],
      words,
      5,
    );
    expect(out).toEqual([]);
  });

  it("drops entries missing required fields", () => {
    const out = finalizeCandidates(
      [
        // missing hookLine
        { startTs: "0:10", endTs: "0:40", score: 0.9 } as unknown as {
          startTs: string;
          endTs: string;
          score: number;
          hookLine: string;
        },
        // score out of range
        { startTs: "0:50", endTs: "1:30", score: 1.5, hookLine: "bad score" },
        // bad timestamp
        { startTs: "garbage", endTs: "0:30", score: 0.5, hookLine: "bad ts" },
      ],
      words,
      5,
    );
    expect(out).toEqual([]);
  });

  it("de-overlaps, keeping the higher-scored candidate", () => {
    const out = finalizeCandidates(
      [
        { startTs: "0:10", endTs: "0:40", score: 0.6, hookLine: "lower" },
        { startTs: "0:20", endTs: "0:50", score: 0.9, hookLine: "higher" },
      ],
      words,
      5,
    );
    expect(out).toHaveLength(1);
    expect(out[0].hookLine).toBe("higher");
  });

  it("caps at maxClips", () => {
    const raw = [
      { startTs: "0:00", endTs: "0:30", score: 0.9, hookLine: "one" },
      { startTs: "0:35", endTs: "1:05", score: 0.85, hookLine: "two" },
      { startTs: "1:10", endTs: "1:40", score: 0.8, hookLine: "three" },
      { startTs: "1:45", endTs: "2:15", score: 0.75, hookLine: "four" },
      { startTs: "2:20", endTs: "2:50", score: 0.7, hookLine: "five" },
      { startTs: "2:55", endTs: "3:25", score: 0.65, hookLine: "six" },
    ];
    const bigWords = makeWords(2000);
    const out = finalizeCandidates(raw, bigWords, 3);
    expect(out).toHaveLength(3);
    // Kept the top 3 scores.
    expect(out.map((c) => c.hookLine).sort()).toEqual(["one", "three", "two"]);
  });

  it("returns candidates sorted by startMs", () => {
    const out = finalizeCandidates(
      [
        { startTs: "1:00", endTs: "1:30", score: 0.7, hookLine: "later" },
        { startTs: "0:10", endTs: "0:40", score: 0.9, hookLine: "earlier" },
      ],
      words,
      5,
    );
    expect(out).toHaveLength(2);
    expect(out[0].hookLine).toBe("earlier");
    expect(out[1].hookLine).toBe("later");
  });

  it("drops candidates whose span is entirely past audio end", () => {
    // Audio is 200 s. Both boundaries clamp to 200 s → 0-length span → dropped.
    const out = finalizeCandidates(
      [{ startTs: "4:00", endTs: "5:00", score: 0.9, hookLine: "past end" }],
      words,
      5,
    );
    expect(out).toEqual([]);
  });

  it("keeps a candidate whose end runs past audio (clamped to audio end)", () => {
    // Audio is 200 s. 3:00–4:00 clamps to 3:00–3:20 → 20 s span, kept.
    const out = finalizeCandidates(
      [{ startTs: "3:00", endTs: "4:00", score: 0.9, hookLine: "runs past end" }],
      words,
      5,
    );
    expect(out).toHaveLength(1);
    expect(out[0].endMs).toBeLessThanOrEqual(200_000);
    expect(out[0].endMs - out[0].startMs).toBeGreaterThanOrEqual(15_000);
  });
});
