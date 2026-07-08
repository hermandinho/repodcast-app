import { describe, expect, it } from "vitest";
import {
  EDIT_TRACKING_SINCE,
  HEADLINE_WINDOW,
  POST_READY_MAX_RATIO,
  computeVoiceProgress,
  editRatioFor,
  isPostReady,
  smoothSeries,
  type ShippedOutputRow,
} from "@/server/ai/voice-progress";

// ============================================================
// Test-data helpers
// ============================================================

function row(overrides: Partial<ShippedOutputRow> = {}): ShippedOutputRow {
  return {
    outputId: `o_${Math.random().toString(36).slice(2, 10)}`,
    episodeId: "ep_1",
    episodeTitle: "Episode 1",
    episodeCreatedAt: new Date("2026-07-01T00:00:00Z"),
    platform: "TWITTER",
    editDistance: 0,
    contentLength: 200,
    ...overrides,
  };
}

// ============================================================
// Constants
// ============================================================

describe("constants", () => {
  it("exposes the edit-tracking migration date so callers can gate queries", () => {
    // The Prisma migration adding `editDistance` landed on 2026-06-29.
    // Rows older than this default to `editDistance = 0` for the wrong
    // reason (column default, not clean ship), so callers must filter.
    expect(EDIT_TRACKING_SINCE.toISOString()).toBe("2026-06-29T00:00:00.000Z");
  });

  it("uses a 10% ratio ceiling for post-ready — matches the north-star copy", () => {
    expect(POST_READY_MAX_RATIO).toBe(0.1);
  });

  it("has a 30-output headline window", () => {
    expect(HEADLINE_WINDOW).toBe(30);
  });
});

// ============================================================
// editRatioFor / isPostReady
// ============================================================

describe("editRatioFor", () => {
  it("returns 0 for an untouched row", () => {
    expect(editRatioFor({ editDistance: 0, contentLength: 200 })).toBe(0);
  });

  it("divides distance by content length", () => {
    expect(editRatioFor({ editDistance: 20, contentLength: 200 })).toBeCloseTo(0.1, 5);
    expect(editRatioFor({ editDistance: 50, contentLength: 100 })).toBeCloseTo(0.5, 5);
  });

  it("clamps at 1 so a total rewrite doesn't skew the metric past 100%", () => {
    expect(editRatioFor({ editDistance: 999, contentLength: 200 })).toBe(1);
  });

  it("treats a zero-length row as length 1 (no NaN)", () => {
    expect(editRatioFor({ editDistance: 0, contentLength: 0 })).toBe(0);
    expect(editRatioFor({ editDistance: 5, contentLength: 0 })).toBe(1);
  });

  it("returns 0 on non-finite / negative inputs — never negative, never NaN", () => {
    expect(editRatioFor({ editDistance: -5, contentLength: 200 })).toBe(0);
  });
});

describe("isPostReady", () => {
  it("is true at exactly the ratio boundary", () => {
    // 20 / 200 === 0.10 → still post-ready (≤ boundary).
    expect(isPostReady({ editDistance: 20, contentLength: 200 })).toBe(true);
  });

  it("is false just past the boundary", () => {
    expect(isPostReady({ editDistance: 21, contentLength: 200 })).toBe(false);
  });

  it("is true for untouched rows", () => {
    expect(isPostReady({ editDistance: 0, contentLength: 200 })).toBe(true);
  });
});

// ============================================================
// computeVoiceProgress — happy path
// ============================================================

describe("computeVoiceProgress", () => {
  it("returns empty series + null headline when no rows", () => {
    const result = computeVoiceProgress([]);
    expect(result.series).toEqual([]);
    expect(result.headline).toEqual({ postReadyRate: null, sampleCount: 0, window: 30 });
    expect(result.milestones).toEqual({ developing: null, strong: null });
  });

  it("groups by episodeId and orders episodes by createdAt ascending", () => {
    const rows = [
      row({
        outputId: "o_c",
        episodeId: "ep_c",
        episodeTitle: "Third",
        episodeCreatedAt: new Date("2026-07-03T00:00:00Z"),
      }),
      row({
        outputId: "o_a",
        episodeId: "ep_a",
        episodeTitle: "First",
        episodeCreatedAt: new Date("2026-07-01T00:00:00Z"),
      }),
      row({
        outputId: "o_b",
        episodeId: "ep_b",
        episodeTitle: "Second",
        episodeCreatedAt: new Date("2026-07-02T00:00:00Z"),
      }),
    ];
    const { series } = computeVoiceProgress(rows);
    expect(series.map((p) => p.episodeIndex)).toEqual([1, 2, 3]);
    expect(series.map((p) => p.title)).toEqual(["First", "Second", "Third"]);
  });

  it("per-episode postReadyRate is the mean of that episode's rows", () => {
    // Three outputs on one episode: 2 post-ready, 1 not → 0.666…
    const rows = [
      row({ outputId: "o1", editDistance: 0, contentLength: 200 }),
      row({ outputId: "o2", editDistance: 15, contentLength: 200 }), // 7.5% → post-ready
      row({ outputId: "o3", editDistance: 50, contentLength: 200 }), // 25% → not
    ];
    const { series } = computeVoiceProgress(rows);
    expect(series).toHaveLength(1);
    expect(series[0].postReadyRate).toBeCloseTo(2 / 3, 5);
    expect(series[0].sampleCount).toBe(3);
  });

  it("headline is the raw row-level rate over the last HEADLINE_WINDOW rows", () => {
    // 40 rows: first 20 all edited-heavy (0% post-ready), last 20 all clean
    // (100% post-ready). Headline window (30) → last 30 rows = 10 heavy + 20
    // clean = 20/30 ≈ 0.666…
    const rows: ShippedOutputRow[] = [];
    for (let i = 0; i < 40; i += 1) {
      rows.push(
        row({
          outputId: `o_${i}`,
          episodeId: `ep_${i}`,
          episodeCreatedAt: new Date(2026, 6, 1 + i),
          editDistance: i < 20 ? 200 : 0,
          contentLength: 200,
        }),
      );
    }
    const { headline } = computeVoiceProgress(rows);
    expect(headline.sampleCount).toBe(30);
    expect(headline.postReadyRate).toBeCloseTo(20 / 30, 5);
  });

  it("headline covers all rows when fewer than the window exist", () => {
    const rows = [
      row({ outputId: "o1", editDistance: 0, contentLength: 200 }),
      row({
        outputId: "o2",
        episodeId: "ep_2",
        episodeCreatedAt: new Date("2026-07-02"),
        editDistance: 100,
        contentLength: 200,
      }),
    ];
    const { headline } = computeVoiceProgress(rows);
    expect(headline.sampleCount).toBe(2);
    expect(headline.postReadyRate).toBeCloseTo(0.5, 5);
  });

  it("marks the Developing milestone at the episode where cumulative rows first ≥ 6", () => {
    // 3 rows per episode → episode 2 lands cumulative 6 (Developing).
    const rows: ShippedOutputRow[] = [];
    for (let ep = 0; ep < 6; ep += 1) {
      for (let n = 0; n < 3; n += 1) {
        rows.push(
          row({
            outputId: `o_${ep}_${n}`,
            episodeId: `ep_${ep}`,
            episodeCreatedAt: new Date(2026, 6, 1 + ep),
          }),
        );
      }
    }
    const { milestones } = computeVoiceProgress(rows);
    expect(milestones.developing).toBe(2); // 3 + 3 = 6 at ep index 2
    expect(milestones.strong).toBe(6); // 3*6 = 18 first crosses 16 at ep index 6
  });

  it("leaves milestones null when the show hasn't reached that band yet", () => {
    // Only 4 rows total — below Developing (6) and Strong (16).
    const rows = [
      row({ outputId: "o1", episodeId: "ep_1", episodeCreatedAt: new Date(2026, 6, 1) }),
      row({ outputId: "o2", episodeId: "ep_1", episodeCreatedAt: new Date(2026, 6, 1) }),
      row({ outputId: "o3", episodeId: "ep_2", episodeCreatedAt: new Date(2026, 6, 2) }),
      row({ outputId: "o4", episodeId: "ep_2", episodeCreatedAt: new Date(2026, 6, 2) }),
    ];
    const { milestones } = computeVoiceProgress(rows);
    expect(milestones.developing).toBeNull();
    expect(milestones.strong).toBeNull();
  });

  it("is deterministic — same rows in shuffled order produce the same result", () => {
    const rows: ShippedOutputRow[] = [];
    for (let ep = 0; ep < 4; ep += 1) {
      for (let n = 0; n < 3; n += 1) {
        rows.push(
          row({
            outputId: `o_${ep}_${n}`,
            episodeId: `ep_${ep}`,
            episodeCreatedAt: new Date(2026, 6, 1 + ep),
            editDistance: ep === 0 ? 100 : 0,
          }),
        );
      }
    }
    const shuffled = [...rows].reverse();
    expect(computeVoiceProgress(rows)).toEqual(computeVoiceProgress(shuffled));
  });
});

// ============================================================
// smoothSeries
// ============================================================

describe("smoothSeries", () => {
  const points = [
    { episodeIndex: 1, episodeId: "e1", title: "1", postReadyRate: 0, sampleCount: 3 },
    { episodeIndex: 2, episodeId: "e2", title: "2", postReadyRate: 1, sampleCount: 3 },
    { episodeIndex: 3, episodeId: "e3", title: "3", postReadyRate: 0, sampleCount: 3 },
    { episodeIndex: 4, episodeId: "e4", title: "4", postReadyRate: 1, sampleCount: 3 },
    { episodeIndex: 5, episodeId: "e5", title: "5", postReadyRate: 0, sampleCount: 3 },
  ];

  it("passes through unchanged for window ≤ 1", () => {
    expect(smoothSeries(points, 1)).toEqual(points);
    expect(smoothSeries(points, 0)).toEqual(points);
  });

  it("centered rolling average smooths the noise", () => {
    const smoothed = smoothSeries(points, 3);
    // Interior points: 3-window mean = (prev + self + next) / 3
    expect(smoothed[1].postReadyRate).toBeCloseTo((0 + 1 + 0) / 3, 5);
    expect(smoothed[2].postReadyRate).toBeCloseTo((1 + 0 + 1) / 3, 5);
    expect(smoothed[3].postReadyRate).toBeCloseTo((0 + 1 + 0) / 3, 5);
    // Edges use the shorter window available (no wrap-around).
    expect(smoothed[0].postReadyRate).toBeCloseTo((0 + 1) / 2, 5);
    expect(smoothed[4].postReadyRate).toBeCloseTo((1 + 0) / 2, 5);
  });

  it("preserves non-rate fields (title, episodeId, index, sampleCount)", () => {
    const smoothed = smoothSeries(points, 3);
    expect(smoothed.map((p) => p.episodeIndex)).toEqual([1, 2, 3, 4, 5]);
    expect(smoothed.map((p) => p.title)).toEqual(points.map((p) => p.title));
    expect(smoothed.map((p) => p.sampleCount)).toEqual([3, 3, 3, 3, 3]);
  });
});
