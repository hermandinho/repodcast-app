import { prisma } from "@/server/db/client";
import {
  priorUtcDay,
  rollupAgencyForDay,
  utcDayRange,
  utcDayStart,
} from "@/server/db/system/rollup";
import { inngest } from "../client";

/**
 * Nightly per-agency usage rollup.
 *
 * Runs at 02:00 UTC, two hours after the day closes, so any in-flight
 * pipeline writes from end-of-day activity have settled. Writes one
 * `AgencyUsageSnapshot` row per (agency, day) — episodes, outputs (current
 * version), AI spend cents, paid-invoice revenue cents.
 *
 * Idempotency: per-agency `step.run` + the `(agencyId, date)` unique index
 * mean a duplicate cron run (or an Inngest retry partway through) overwrites
 * the same row instead of inserting twice.
 *
 * Why per-agency `step.run`: Inngest memoizes step results, so an exception
 * in one agency's rollup doesn't force the whole batch to re-run from
 * scratch. Cheap insurance on a once-a-day job.
 *
 * Backfill: fires through the same per-agency-per-day worker via the
 * `system/rollup.backfill.requested` event, so the math is identical to the
 * nightly run.
 */

export const nightlyUsageRollup = inngest.createFunction(
  {
    id: "nightly-usage-rollup",
    triggers: [{ cron: "0 2 * * *" }],
    retries: 3,
  },
  async ({ step }) => {
    const now = new Date();
    const day = priorUtcDay(now);

    // Read OUTSIDE step.run — same gotcha as `check-renewals` (Inngest
    // JSONifies step return values, which would round-trip dates back to
    // strings here).
    const agencies = await prisma.agency.findMany({
      select: { id: true, plan: true },
    });

    let written = 0;
    for (const agency of agencies) {
      await step.run(`rollup-${agency.id}`, () =>
        rollupAgencyForDay({ agencyId: agency.id, plan: agency.plan, dayStart: day }),
      );
      written += 1;
    }

    return {
      ranAt: now.toISOString(),
      dayCovered: day.toISOString(),
      agenciesRolledUp: written,
    };
  },
);

/**
 * Backfill the rollup for an arbitrary UTC-date range. Fired via:
 *
 *   inngest.send({
 *     name: "system/rollup.backfill.requested",
 *     data: { fromIso: "2026-01-01T00:00:00Z", toIso: "2026-06-30T00:00:00Z" }
 *   });
 *
 * Range is inclusive-of-`from`, exclusive-of-`to` (same convention as the
 * cron itself). Each day × agency pair is its own `step.run` so a failure
 * mid-backfill resumes from where it left off.
 */
export const backfillUsageRollup = inngest.createFunction(
  {
    id: "backfill-usage-rollup",
    triggers: [{ event: "system/rollup.backfill.requested" }],
    retries: 3,
  },
  async ({ event, step }) => {
    const from = utcDayStart(new Date(event.data.fromIso));
    const to = utcDayStart(new Date(event.data.toIso));
    const days = utcDayRange(from, to);

    const agencies = await prisma.agency.findMany({
      select: { id: true, plan: true },
    });

    let written = 0;
    for (const day of days) {
      for (const agency of agencies) {
        await step.run(`rollup-${day.toISOString().slice(0, 10)}-${agency.id}`, () =>
          rollupAgencyForDay({ agencyId: agency.id, plan: agency.plan, dayStart: day }),
        );
        written += 1;
      }
    }

    return {
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
      daysCovered: days.length,
      agencyCount: agencies.length,
      rowsWritten: written,
    };
  },
);
