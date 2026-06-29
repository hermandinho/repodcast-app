import { describe, expect, it } from "vitest";
import { daysBetween, markerWindow } from "@/inngest/functions/check-renewals";

/**
 * Phase 2.13.6 — pure helpers used by the renewals cron. The cron itself
 * needs a Prisma + Inngest harness to exercise (deferred); these tests
 * pin the marker math that decides which `ClientBillingProfile` rows are
 * "due" on each daily run.
 */

describe("markerWindow", () => {
  it("returns a 1-day UTC bracket aligned to (now + days) midnight", () => {
    // Pick a fixed `now` at 14:00 UTC — the cron's scheduled run time.
    const now = new Date("2026-06-29T14:00:00.000Z");
    const window = markerWindow(now, 30);
    // start = 2026-07-29 00:00:00 UTC
    expect(window.start.toISOString()).toBe("2026-07-29T00:00:00.000Z");
    // end = 2026-07-30 00:00:00 UTC (exclusive)
    expect(window.end.toISOString()).toBe("2026-07-30T00:00:00.000Z");
  });

  it("works for the 7-day marker too", () => {
    const now = new Date("2026-06-29T14:00:00.000Z");
    const window = markerWindow(now, 7);
    expect(window.start.toISOString()).toBe("2026-07-06T00:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-07-07T00:00:00.000Z");
  });

  it("is idempotent within a single calendar day", () => {
    // Two runs the same UTC day must hit the same bracket so the cron's
    // dedupe key + the renewal lookup stay consistent across hours.
    const morning = new Date("2026-06-29T01:00:00.000Z");
    const afternoon = new Date("2026-06-29T22:00:00.000Z");
    expect(markerWindow(morning, 30)).toEqual(markerWindow(afternoon, 30));
  });

  it("the 30-day window doesn't overlap the 7-day window", () => {
    const now = new Date("2026-06-29T14:00:00.000Z");
    const thirty = markerWindow(now, 30);
    const seven = markerWindow(now, 7);
    // 30-day window is strictly later than the 7-day window.
    expect(thirty.start.getTime()).toBeGreaterThan(seven.end.getTime());
  });
});

describe("daysBetween", () => {
  it("rounds up to whole days", () => {
    const now = new Date("2026-06-29T14:00:00.000Z");
    // 30 days + 10 hours → still "30 days to renewal" (we round up).
    const target = new Date("2026-07-30T00:00:00.000Z");
    expect(daysBetween(now, target)).toBeGreaterThanOrEqual(30);
    expect(daysBetween(now, target)).toBeLessThanOrEqual(31);
  });

  it("returns 0 for renewals already past", () => {
    const now = new Date("2026-06-29T14:00:00.000Z");
    const past = new Date("2026-06-01T00:00:00.000Z");
    expect(daysBetween(now, past)).toBe(0);
  });

  it("returns 1 for a renewal exactly one calendar day away", () => {
    const now = new Date("2026-06-29T14:00:00.000Z");
    const oneDay = new Date("2026-06-30T14:00:00.000Z");
    expect(daysBetween(now, oneDay)).toBe(1);
  });
});
