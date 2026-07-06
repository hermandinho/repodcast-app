import { describe, expect, it } from "vitest";
import {
  VOICE_DRIFT_COOLDOWN_SAMPLES,
  VOICE_DRIFT_RATIO_THRESHOLD,
  VOICE_LEVEL_THRESHOLDS,
  VOICE_PERIODIC_REFRESH_INTERVAL,
  VOICE_REFRESH_THRESHOLDS,
  computeRecentDriftRatio,
  crossedVoiceRefreshThreshold,
  shouldRefreshVoiceDescription,
  voiceLevel,
} from "@/server/ai/voice-strength";

describe("voiceLevel", () => {
  it("labels each strength band by the documented thresholds", () => {
    expect(voiceLevel(0)).toBe("Weak");
    expect(voiceLevel(VOICE_LEVEL_THRESHOLDS.developing - 1)).toBe("Weak");
    expect(voiceLevel(VOICE_LEVEL_THRESHOLDS.developing)).toBe("Developing");
    expect(voiceLevel(VOICE_LEVEL_THRESHOLDS.strong - 1)).toBe("Developing");
    expect(voiceLevel(VOICE_LEVEL_THRESHOLDS.strong)).toBe("Strong");
    expect(voiceLevel(100)).toBe("Strong");
  });
});

describe("crossedVoiceRefreshThreshold", () => {
  it("fires exactly when a threshold is just crossed", () => {
    // First-ever sample — initial profile threshold (1).
    expect(crossedVoiceRefreshThreshold(0, 1)).toBe(true);
    // Crossing into Developing.
    expect(crossedVoiceRefreshThreshold(5, 6)).toBe(true);
    // Crossing into Strong.
    expect(crossedVoiceRefreshThreshold(15, 16)).toBe(true);
    // Past-Strong milestone.
    expect(crossedVoiceRefreshThreshold(29, 30)).toBe(true);
  });

  it("does not fire when the sample is inside a band", () => {
    expect(crossedVoiceRefreshThreshold(7, 8)).toBe(false);
    expect(crossedVoiceRefreshThreshold(17, 18)).toBe(false);
    expect(crossedVoiceRefreshThreshold(30, 31)).toBe(false);
  });

  it("does not fire if the count went backwards or stayed the same", () => {
    expect(crossedVoiceRefreshThreshold(6, 6)).toBe(false);
    expect(crossedVoiceRefreshThreshold(16, 15)).toBe(false);
  });

  it("declares its refresh thresholds explicitly", () => {
    expect(VOICE_REFRESH_THRESHOLDS).toEqual([1, 6, 16, 30]);
  });
});

describe("computeRecentDriftRatio", () => {
  it("returns undefined when no sample carries an editDistance", () => {
    expect(computeRecentDriftRatio([])).toBeUndefined();
    expect(
      computeRecentDriftRatio([
        { content: "abc", editDistance: null },
        { content: "def", editDistance: undefined },
      ]),
    ).toBeUndefined();
  });

  it("averages edit ratios across samples that carry an editDistance", () => {
    const ratio = computeRecentDriftRatio([
      { content: "x".repeat(100), editDistance: 20 }, // 0.2
      { content: "x".repeat(100), editDistance: 40 }, // 0.4
      { content: "x".repeat(100), editDistance: 60 }, // 0.6
    ]);
    expect(ratio).toBeCloseTo(0.4, 3);
  });

  it("clamps per-sample ratio at 1 so a total rewrite doesn't skew the average", () => {
    const ratio = computeRecentDriftRatio([
      { content: "x".repeat(100), editDistance: 500 }, // clamped to 1
      { content: "x".repeat(100), editDistance: 0 }, // 0
    ]);
    expect(ratio).toBeCloseTo(0.5, 3);
  });

  it("skips samples without an editDistance rather than counting them as 0", () => {
    const ratio = computeRecentDriftRatio([
      { content: "x".repeat(100), editDistance: 80 }, // 0.8
      { content: "x".repeat(100), editDistance: null }, // skipped
      { content: "x".repeat(100), editDistance: undefined }, // skipped
    ]);
    expect(ratio).toBeCloseTo(0.8, 3);
  });
});

describe("shouldRefreshVoiceDescription", () => {
  const baseline = {
    previousSampleCount: 10,
    newSampleCount: 11,
    sampleCountAtLastRefresh: 10,
    recentDriftRatio: 0,
  } as const;

  it("fires at each original milestone (1/6/16/30)", () => {
    for (const milestone of VOICE_REFRESH_THRESHOLDS) {
      expect(
        shouldRefreshVoiceDescription({
          ...baseline,
          previousSampleCount: milestone - 1,
          newSampleCount: milestone,
          sampleCountAtLastRefresh: 0,
        }),
      ).toBe(true);
    }
  });

  it("fires a periodic refresh every N samples past the last milestone (30)", () => {
    const last = VOICE_REFRESH_THRESHOLDS[VOICE_REFRESH_THRESHOLDS.length - 1];
    const interval = VOICE_PERIODIC_REFRESH_INTERVAL;
    // At `last + interval - 1` we're still one sample short — no fire.
    expect(
      shouldRefreshVoiceDescription({
        ...baseline,
        previousSampleCount: last + interval - 2,
        newSampleCount: last + interval - 1,
        sampleCountAtLastRefresh: last,
      }),
    ).toBe(false);
    // At `last + interval` we've now advanced enough — fire.
    expect(
      shouldRefreshVoiceDescription({
        ...baseline,
        previousSampleCount: last + interval - 1,
        newSampleCount: last + interval,
        sampleCountAtLastRefresh: last,
      }),
    ).toBe(true);
    // And it keeps firing on the next interval boundary after that.
    expect(
      shouldRefreshVoiceDescription({
        ...baseline,
        previousSampleCount: last + 2 * interval - 1,
        newSampleCount: last + 2 * interval,
        sampleCountAtLastRefresh: last + interval,
      }),
    ).toBe(true);
  });

  it("fires on drift once the cooldown clears", () => {
    // Drift above threshold, cooldown NOT yet cleared → hold off.
    expect(
      shouldRefreshVoiceDescription({
        previousSampleCount: 20,
        newSampleCount: 21,
        sampleCountAtLastRefresh: 20, // 1 sample since — below the 5-sample cooldown
        recentDriftRatio: VOICE_DRIFT_RATIO_THRESHOLD + 0.05,
      }),
    ).toBe(false);
    // Same drift, cooldown cleared → fire.
    expect(
      shouldRefreshVoiceDescription({
        previousSampleCount: 24,
        newSampleCount: 25,
        sampleCountAtLastRefresh: 20, // 5 samples since — clears cooldown
        recentDriftRatio: VOICE_DRIFT_RATIO_THRESHOLD + 0.05,
      }),
    ).toBe(true);
  });

  it("does not fire on drift when the ratio is below threshold", () => {
    expect(
      shouldRefreshVoiceDescription({
        previousSampleCount: 24,
        newSampleCount: 25,
        sampleCountAtLastRefresh: 20,
        recentDriftRatio: VOICE_DRIFT_RATIO_THRESHOLD - 0.01,
      }),
    ).toBe(false);
  });

  it("treats an undefined drift ratio as no signal (no drift fire)", () => {
    // No editDistance available anywhere → drift path never activates.
    expect(
      shouldRefreshVoiceDescription({
        previousSampleCount: 24,
        newSampleCount: 25,
        sampleCountAtLastRefresh: 20,
        recentDriftRatio: undefined,
      }),
    ).toBe(false);
  });

  it("cooldown constant matches the documented value", () => {
    expect(VOICE_DRIFT_COOLDOWN_SAMPLES).toBe(5);
  });
});
