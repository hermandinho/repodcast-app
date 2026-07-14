import { describe, expect, it } from "vitest";
import { day2Window } from "@/inngest/functions/check-trial-nudges";
import { TRIAL_DAYS } from "@/lib/plans";

/**
 * Window math for the mid-trial nudge cron. Pins the "2 days
 * in" bracket so a daily cron fire lands the email exactly once per
 * (agency, "day_2") without slop from clock skew.
 *
 * Approach mirrors `markerWindow` in `check-onboarding-nudges.test.ts`:
 * exercise the pure fn, leave the full DB / Inngest harness for a smoke-
 * test in `docs/trial-smoke-test.md`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HALF_DAY_MS = 12 * 60 * 60 * 1000;

describe("day2Window", () => {
  it("centers on `now + (TRIAL_DAYS - 2) days` with a ±½ day radius", () => {
    const now = new Date("2026-07-03T15:00:00.000Z");
    const { start, end } = day2Window(now);
    const expectedCenter = now.getTime() + (TRIAL_DAYS - 2) * DAY_MS;
    expect(start.getTime()).toBe(expectedCenter - HALF_DAY_MS);
    expect(end.getTime()).toBe(expectedCenter + HALF_DAY_MS);
    // Window is exactly one day wide — a daily cron fire covers it.
    expect(end.getTime() - start.getTime()).toBe(DAY_MS);
  });

  it("catches a trial that started at cron-fire time (trialEndsAt = now + TRIAL_DAYS)", () => {
    // Agency signed up right before the cron fired: trialEndsAt is exactly
    // TRIAL_DAYS days out. That trial is 0 days in — NOT eligible for the
    // day-2 nudge yet.
    const now = new Date("2026-07-03T15:00:00.000Z");
    const freshTrialEnd = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
    const { start, end } = day2Window(now);
    expect(
      freshTrialEnd.getTime() >= start.getTime() && freshTrialEnd.getTime() < end.getTime(),
    ).toBe(false);
  });

  it("catches a trial that's been running ~2 days (trialEndsAt = now + TRIAL_DAYS - 2)", () => {
    const now = new Date("2026-07-03T15:00:00.000Z");
    const twoDaysIn = new Date(now.getTime() + (TRIAL_DAYS - 2) * DAY_MS);
    const { start, end } = day2Window(now);
    expect(twoDaysIn.getTime() >= start.getTime() && twoDaysIn.getTime() < end.getTime()).toBe(
      true,
    );
  });

  it("misses a trial that's already past the mid-trial window (trialEndsAt < window.start)", () => {
    const now = new Date("2026-07-03T15:00:00.000Z");
    // Trial ends in ~1 day → we're already past the day-2 mark. The T-3
    // nudge (Stripe-driven) handles this population.
    const almostOver = new Date(now.getTime() + 1 * DAY_MS);
    const { start } = day2Window(now);
    expect(almostOver.getTime() < start.getTime()).toBe(true);
  });
});
