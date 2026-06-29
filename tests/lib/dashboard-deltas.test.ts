import { describe, expect, it } from "vitest";
import { formatAbsDelta, formatPctDelta } from "@/lib/dashboard-deltas";

describe("formatAbsDelta", () => {
  it("uses ▲ + named prior month when current > prior", () => {
    expect(formatAbsDelta(9, 7, "May")).toBe("▲ 2 vs. May");
  });

  it("uses ▼ + named prior month when current < prior", () => {
    expect(formatAbsDelta(5, 7, "May")).toBe("▼ 2 vs. May");
  });

  it("uses ± when current == prior (both non-zero)", () => {
    expect(formatAbsDelta(7, 7, "May")).toBe("± vs. May");
  });

  it("returns empty when both are zero (no signal yet)", () => {
    expect(formatAbsDelta(0, 0, "May")).toBe("");
  });

  it("uses ▲ when current is positive and prior is zero", () => {
    // 3 vs. 0 isn't undefined for absolute deltas — just say ▲ 3.
    expect(formatAbsDelta(3, 0, "May")).toBe("▲ 3 vs. May");
  });

  it("uses ▼ when current is zero and prior was positive", () => {
    expect(formatAbsDelta(0, 4, "May")).toBe("▼ 4 vs. May");
  });
});

describe("formatPctDelta", () => {
  it("rounds positive percent change", () => {
    // (63 - 50) / 50 = 0.26 → 26%
    expect(formatPctDelta(63, 50)).toBe("▲ 26%");
  });

  it("rounds negative percent change", () => {
    // (40 - 50) / 50 = -0.20 → 20%
    expect(formatPctDelta(40, 50)).toBe("▼ 20%");
  });

  it("uses ± when current == prior (both non-zero)", () => {
    expect(formatPctDelta(50, 50)).toBe("± vs. prev");
  });

  it("returns '▲ new' when prior is zero and current is positive", () => {
    // Percent change is undefined but the lift is real — surface it.
    expect(formatPctDelta(10, 0)).toBe("▲ new");
  });

  it("returns empty when both are zero", () => {
    expect(formatPctDelta(0, 0)).toBe("");
  });

  it("rounds toward nearest (half rounds up by JS spec)", () => {
    // (3 - 2) / 2 = 0.5 → Math.round → 1 → +50%
    expect(formatPctDelta(3, 2)).toBe("▲ 50%");
  });
});
