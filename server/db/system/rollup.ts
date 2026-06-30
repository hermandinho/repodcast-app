import "server-only";

import type { Plan } from "@prisma/client";
import { prisma } from "@/server/db/client";

/**
 * Helpers + per-day worker for the nightly `AgencyUsageSnapshot` rollup.
 *
 * Split out of `inngest/functions/nightly-usage-rollup.ts` so the date math +
 * the upsert payload shape can be unit-tested without an Inngest harness.
 *
 * Day boundaries are **UTC midnight, full stop**. Anchoring to local time
 * would make a single agency's "Monday" mean different things depending on
 * where the cron node ran; UTC is the only sane key.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Return `00:00 UTC` of the day containing `date`. Idempotent: passing a
 * value that's already midnight UTC returns the same instant.
 */
export function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Return `00:00 UTC` of the day BEFORE the one containing `now`. The cron
 * runs at 02:00 UTC and rolls up the just-closed UTC day, so this is what
 * it asks for.
 */
export function priorUtcDay(now: Date): Date {
  const today = utcDayStart(now);
  return new Date(today.getTime() - MS_PER_DAY);
}

/**
 * Every UTC midnight in `[fromUtc, toUtc)`, oldest first. Used by the
 * backfill path. Both bounds are normalised to `utcDayStart` so a caller
 * passing a non-midnight value doesn't accidentally skip / double-up a day.
 */
export function utcDayRange(fromUtc: Date, toUtc: Date): Date[] {
  const from = utcDayStart(fromUtc);
  const to = utcDayStart(toUtc);
  if (to <= from) return [];
  const days: Date[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += MS_PER_DAY) {
    days.push(new Date(t));
  }
  return days;
}

/**
 * Aggregate one (agency, day) tuple and upsert the snapshot row. Idempotent
 * — re-running for the same key updates the existing row instead of
 * inserting a duplicate (backed by the `@@unique([agencyId, date])`
 * constraint).
 *
 * Returns the resulting snapshot so the cron can log totals.
 */
export async function rollupAgencyForDay(input: {
  agencyId: string;
  plan: Plan;
  dayStart: Date;
}): Promise<{ episodes: number; outputs: number; costCents: number; revenueCents: number }> {
  const { agencyId, plan, dayStart } = input;
  const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY);

  const [episodes, outputs, costAgg, revenueAgg] = await Promise.all([
    prisma.episode.count({
      where: {
        createdAt: { gte: dayStart, lt: dayEnd },
        show: { client: { agencyId } },
      },
    }),
    prisma.generatedOutput.count({
      where: {
        createdAt: { gte: dayStart, lt: dayEnd },
        supersededAt: null,
        episode: { show: { client: { agencyId } } },
      },
    }),
    prisma.usageLog.aggregate({
      where: { agencyId, createdAt: { gte: dayStart, lt: dayEnd } },
      _sum: { costCents: true },
    }),
    prisma.invoice.aggregate({
      where: { agencyId, status: "PAID", createdAt: { gte: dayStart, lt: dayEnd } },
      _sum: { amountCents: true },
    }),
  ]);

  const totals = {
    episodes,
    outputs,
    costCents: costAgg._sum.costCents ?? 0,
    revenueCents: revenueAgg._sum.amountCents ?? 0,
  };

  await prisma.agencyUsageSnapshot.upsert({
    where: { agencyId_date: { agencyId, date: dayStart } },
    create: { agencyId, date: dayStart, plan, ...totals },
    update: { plan, ...totals },
  });

  return totals;
}
