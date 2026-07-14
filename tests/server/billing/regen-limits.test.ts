import { describe, expect, it, beforeEach } from "vitest";
import { PLAN_LIMITS, REGEN_UNLIMITED } from "@/lib/plans";

/**
 * PricingV2 §3 — regen budgets. These are static assertions on the
 * PLAN_LIMITS table; runtime consumption is tested via the
 * agency-regen-counters integration harness (real DB required — not
 * run in this suite).
 */

describe("PLAN_LIMITS — PricingV2 regen budgets", () => {
  it("Solo gets a starter budget (40/10/40)", () => {
    expect(PLAN_LIMITS.SOLO.clipRegenerationsPerMonth).toBe(40);
    expect(PLAN_LIMITS.SOLO.artworkRegenerationsPerMonth).toBe(10);
    expect(PLAN_LIMITS.SOLO.audiogramRegenerationsPerMonth).toBe(40);
  });

  it("Studio scales up ~5x for clip/audiogram, 4x for artwork", () => {
    expect(PLAN_LIMITS.STUDIO.clipRegenerationsPerMonth).toBe(200);
    expect(PLAN_LIMITS.STUDIO.artworkRegenerationsPerMonth).toBe(40);
    expect(PLAN_LIMITS.STUDIO.audiogramRegenerationsPerMonth).toBe(200);
  });

  it("Agency scales further (500/100/500)", () => {
    expect(PLAN_LIMITS.AGENCY.clipRegenerationsPerMonth).toBe(500);
    expect(PLAN_LIMITS.AGENCY.artworkRegenerationsPerMonth).toBe(100);
    expect(PLAN_LIMITS.AGENCY.audiogramRegenerationsPerMonth).toBe(500);
  });

  it("Network is soft-unlimited on all three", () => {
    expect(PLAN_LIMITS.NETWORK.clipRegenerationsPerMonth).toBe(REGEN_UNLIMITED);
    expect(PLAN_LIMITS.NETWORK.artworkRegenerationsPerMonth).toBe(REGEN_UNLIMITED);
    expect(PLAN_LIMITS.NETWORK.audiogramRegenerationsPerMonth).toBe(REGEN_UNLIMITED);
  });
});

describe("PLAN_LIMITS — PricingV2 clipsPerEpisode", () => {
  it("Solo gets 3 clips per episode", () => {
    expect(PLAN_LIMITS.SOLO.clipsPerEpisode).toBe(3);
  });
  it("Studio + Agency get 5", () => {
    expect(PLAN_LIMITS.STUDIO.clipsPerEpisode).toBe(5);
    expect(PLAN_LIMITS.AGENCY.clipsPerEpisode).toBe(5);
  });
  it("Network doubles to 10 for headroom", () => {
    expect(PLAN_LIMITS.NETWORK.clipsPerEpisode).toBe(10);
  });
});

describe("PLAN_LIMITS — budgets are monotonically non-decreasing up the ladder", () => {
  const tiers = ["SOLO", "STUDIO", "AGENCY", "NETWORK"] as const;
  const keys = [
    "shows",
    "seats",
    "episodesPerMonth",
    "generationsPerMonth",
    "monthlyCostCapCents",
    "clipsPerEpisode",
    "clipRegenerationsPerMonth",
    "artworkRegenerationsPerMonth",
    "audiogramRegenerationsPerMonth",
  ] as const;
  let previousAdequate = true;

  beforeEach(() => {
    previousAdequate = true;
  });

  for (const key of keys) {
    it(`${key} never decreases up the tier ladder`, () => {
      for (let i = 1; i < tiers.length; i++) {
        const prev = PLAN_LIMITS[tiers[i - 1]][key];
        const curr = PLAN_LIMITS[tiers[i]][key];
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
      // touch previousAdequate so it's not unused
      expect(previousAdequate).toBe(true);
    });
  }
});
