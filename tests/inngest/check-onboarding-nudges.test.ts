import { describe, expect, it } from "vitest";
import { markerWindow } from "@/inngest/functions/check-onboarding-nudges";

/**
 * Pure marker math for the onboarding drop-off cron. The cron
 * itself needs a Prisma + Inngest harness to exercise (same blocker as
 * `check-renewals`); these tests pin the hourly window so the function
 * fires each marker exactly once per (agency, marker) under normal scheduling.
 */

describe("markerWindow", () => {
  it("returns an hour-wide bracket ending at `now - hours`", () => {
    const now = new Date("2026-07-01T14:00:00.000Z");
    const w = markerWindow(now, 24);
    // end = now - 24h
    expect(w.end.toISOString()).toBe("2026-06-30T14:00:00.000Z");
    // start = end - 1h
    expect(w.start.toISOString()).toBe("2026-06-30T13:00:00.000Z");
  });

  it("catches an agency that signed up exactly 24h ago at the marker boundary", () => {
    const signup = new Date("2026-06-30T14:00:00.000Z");
    // Cron runs at the top of the hour 24h later.
    const now = new Date("2026-07-01T14:00:00.000Z");
    const { start, end } = markerWindow(now, 24);
    // The window is `[start, end)` so 14:00 (== end) is OUTSIDE this window —
    // but the next hourly run lands it. Confirm the boundary call:
    expect(signup.getTime() >= start.getTime() && signup.getTime() < end.getTime()).toBe(false);

    // One hour later the same signup falls inside the new window.
    const later = new Date("2026-07-01T15:00:00.000Z");
    const next = markerWindow(later, 24);
    expect(signup.getTime() >= next.start.getTime() && signup.getTime() < next.end.getTime()).toBe(
      true,
    );
  });

  it("the 24h and 72h windows don't overlap", () => {
    const now = new Date("2026-07-01T14:00:00.000Z");
    const w24 = markerWindow(now, 24);
    const w72 = markerWindow(now, 72);
    // 72h window is strictly earlier than the 24h window.
    expect(w72.end.getTime()).toBeLessThan(w24.start.getTime());
  });

  it("slides forward by exactly 1h between hourly runs", () => {
    const t1 = new Date("2026-07-01T14:00:00.000Z");
    const t2 = new Date("2026-07-01T15:00:00.000Z");
    const w1 = markerWindow(t1, 24);
    const w2 = markerWindow(t2, 24);
    // Window-2 starts exactly where Window-1 ends, so back-to-back hourly
    // runs partition signups without overlap or gap.
    expect(w2.start.toISOString()).toBe(w1.end.toISOString());
  });
});
