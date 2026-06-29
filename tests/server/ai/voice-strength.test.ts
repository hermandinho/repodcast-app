import { describe, expect, it } from "vitest";
import {
  VOICE_LEVEL_THRESHOLDS,
  VOICE_REFRESH_THRESHOLDS,
  crossedVoiceRefreshThreshold,
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
