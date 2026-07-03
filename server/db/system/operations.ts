import "server-only";

import { type Plan } from "@prisma/client";
import { priceFor } from "@/lib/plans";
import { assertSystemRole, SYSTEM_READ_ROLES, type SystemAdminContext } from "@/server/auth/system";
import { prisma } from "@/server/db/client";

/**
 * Phase 3.6.8 — operational analytics repo helpers.
 *
 * v1 scope (ship-order step 7) — everything derivable from existing rows:
 *   - AI spend rollup: today / MTD / lifetime, by model, by agency (top 20),
 *     per-agency margin (MRR − cost), straight-line month-end forecast.
 *   - Queue health (DB-side only): in-flight episode count, failed counts
 *     24h + lifetime, last 50 failed episodes with `failureReason` + agency
 *     context.
 *   - Webhook deliveries: per-source 30-day totals + per-day series for a
 *     sparkline. Sourced from the existing `WebhookDelivery` rows.
 *
 * Deferred (each blocked on an external API or schema addition):
 *   - Inngest-side queue depth / p50-p99 durations / pass-fail per function
 *     (needs the Inngest REST/GraphQL surface + per-function auth).
 *   - R2 storage by prefix (needs S3 `ListObjectsV2` calls — expensive
 *     without an index; future cron writes counters into a snapshot table).
 *   - Email deliverability (needs an `EmailDelivery` log table + Resend
 *     webhook intake).
 *   - External-API status grid (needs an `HealthProbe` ping cron — lands
 *     with §3.6.12 system-health surface).
 *   - Per-platform spend (UsageLog has no `platform` column; would need
 *     either a schema change or a fragile time-window join to outputs).
 *   - Manual Inngest re-fire (needs Inngest mutation + audit row).
 *
 * Open to every system read role (ROOT / OPERATOR / SUPPORT / ANALYST).
 */

// ============================================================
// Public type
// ============================================================

export type OperationsSummary = {
  aiSpend: {
    todayCents: number;
    mtdCents: number;
    lifetimeCents: number;
    /** MTD × (daysInMonth / dayOfMonth). Straight-line projection only. */
    forecastedMonthEndCents: number;
    /** Sorted by costCents descending. */
    byModel: Array<{ model: string; calls: number; costCents: number }>;
    /**
     * Top 20 agencies by MTD spend. `marginCentsMtd` = monthly plan price
     * (USD cents) − MTD cost. Negative values flag agencies that lose us
     * money on serving costs alone.
     */
    topAgencies: Array<{
      agencyId: string;
      agencyName: string;
      plan: Plan;
      costCentsMtd: number;
      mrrCentsMonthly: number;
      marginCentsMtd: number;
    }>;
  };
  queue: {
    inFlightEpisodes: number;
    failedEpisodes24h: number;
    failedEpisodesLifetime: number;
    recentFailures: Array<{
      episodeId: string;
      episodeTitle: string;
      agencyId: string;
      agencyName: string;
      failureReason: string | null;
      updatedAt: Date;
    }>;
  };
  webhooks: {
    /** Per-source totals over last 30d, sorted by count desc. */
    bySource30d: Array<{ source: string; count: number }>;
    /**
     * Per-day combined-source counts for the sparkline. Always 30 entries,
     * zero-filled, ascending by day.
     */
    daily30d: Array<{ dayIso: string; count: number }>;
  };
};

export async function getOperationsSummary(ctx: SystemAdminContext): Promise<OperationsSummary> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const now = new Date();
  const ms = monthStart(now);
  const todayUtc = utcDayStart(now);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = utcDayStart(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));

  const [
    spendTodayAgg,
    spendMtdAgg,
    spendLifetimeAgg,
    spendByModel,
    spendByAgencyMtd,
    inFlightEpisodes,
    failedEpisodes24h,
    failedEpisodesLifetime,
    recentFailureRows,
    webhookBySource30d,
    webhookRowsFor30d,
  ] = await Promise.all([
    prisma.usageLog.aggregate({
      where: { createdAt: { gte: todayUtc } },
      _sum: { costCents: true },
    }),
    prisma.usageLog.aggregate({
      where: { createdAt: { gte: ms } },
      _sum: { costCents: true },
    }),
    prisma.usageLog.aggregate({ _sum: { costCents: true } }),
    prisma.usageLog.groupBy({
      by: ["model"],
      where: { createdAt: { gte: ms } },
      _sum: { costCents: true },
      _count: { _all: true },
    }),
    prisma.usageLog.groupBy({
      by: ["agencyId"],
      where: { createdAt: { gte: ms } },
      _sum: { costCents: true },
      orderBy: { _sum: { costCents: "desc" } },
      take: 20,
    }),
    prisma.episode.count({ where: { status: "PROCESSING" } }),
    prisma.episode.count({
      where: { status: "FAILED", updatedAt: { gte: dayAgo } },
    }),
    prisma.episode.count({ where: { status: "FAILED" } }),
    prisma.episode.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        failureReason: true,
        updatedAt: true,
        show: {
          select: { client: { select: { agencyId: true, agency: { select: { name: true } } } } },
        },
      },
    }),
    prisma.webhookDelivery.groupBy({
      by: ["source"],
      where: { processedAt: { gte: thirtyDaysAgo } },
      _count: { _all: true },
    }),
    // Pull per-row processedAt for the daily series — bounded by 30d *
    // typical webhook rate. At launch volume this is in the thousands, well
    // under any concerning limit. Swap to a `WebhookDeliverySnapshot` if
    // this ever shows up in profiling.
    prisma.webhookDelivery.findMany({
      where: { processedAt: { gte: thirtyDaysAgo } },
      select: { processedAt: true },
    }),
  ]);

  // ---- AI spend ----------------------------------------------------------

  const mtdCents = spendMtdAgg._sum.costCents ?? 0;
  const lifetimeCents = spendLifetimeAgg._sum.costCents ?? 0;
  const todayCents = spendTodayAgg._sum.costCents ?? 0;
  const forecastedMonthEndCents = forecastMonthEnd(now, mtdCents);

  const byModel = spendByModel
    .map((r) => ({
      model: r.model,
      calls: r._count._all,
      costCents: r._sum.costCents ?? 0,
    }))
    .sort((a, b) => b.costCents - a.costCents);

  // Resolve agency names + plans for the top-20 spend rows.
  const topAgencyIds = spendByAgencyMtd.map((r) => r.agencyId);
  const agenciesById =
    topAgencyIds.length === 0
      ? new Map<string, { name: string; plan: Plan }>()
      : new Map(
          (
            await prisma.agency.findMany({
              where: { id: { in: topAgencyIds } },
              select: { id: true, name: true, plan: true },
            })
          ).map((a) => [a.id, { name: a.name, plan: a.plan }] as const),
        );

  const topAgencies = spendByAgencyMtd
    .map((r) => {
      const agency = agenciesById.get(r.agencyId);
      if (!agency) return null;
      const costCentsMtd = r._sum.costCents ?? 0;
      const mrrCentsMonthly = priceFor(agency.plan) * 100;
      return {
        agencyId: r.agencyId,
        agencyName: agency.name,
        plan: agency.plan,
        costCentsMtd,
        mrrCentsMonthly,
        marginCentsMtd: mrrCentsMonthly - costCentsMtd,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  // ---- Queue health ------------------------------------------------------

  const recentFailures = recentFailureRows.map((r) => ({
    episodeId: r.id,
    episodeTitle: r.title,
    agencyId: r.show.client.agencyId,
    agencyName: r.show.client.agency.name,
    failureReason: r.failureReason,
    updatedAt: r.updatedAt,
  }));

  // ---- Webhooks ----------------------------------------------------------

  const bySource30d = webhookBySource30d
    .map((r) => ({ source: r.source, count: r._count._all }))
    .sort((a, b) => b.count - a.count);

  const daily30d = bucketDailySeries(thirtyDaysAgo, todayUtc, webhookRowsFor30d);

  return {
    aiSpend: {
      todayCents,
      mtdCents,
      lifetimeCents,
      forecastedMonthEndCents,
      byModel,
      topAgencies,
    },
    queue: {
      inFlightEpisodes,
      failedEpisodes24h,
      failedEpisodesLifetime,
      recentFailures,
    },
    webhooks: { bySource30d, daily30d },
  };
}

// ============================================================
// Pure date / forecast helpers — exported for tests
// ============================================================

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Straight-line projection: pace the current MTD spend out to the end of
 * the calendar month. Day-1 forecasts MAX out at `mtdCents × daysInMonth`
 * which is intentional — if you've spent $X on the 1st and that rate
 * holds, you'll spend X × 30 by month end. Tighten the projection model
 * once we have enough months of history to fit a curve.
 *
 * Exported for tests.
 */
export function forecastMonthEnd(now: Date, mtdCents: number): number {
  if (mtdCents <= 0) return 0;
  const dayOfMonth = now.getUTCDate(); // 1-based, never < 1
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return Math.round((mtdCents * daysInMonth) / dayOfMonth);
}

/**
 * Bucket per-row dates into a zero-filled day-keyed series spanning
 * [from, to) inclusive. Always returns 30 entries when called with the
 * 30-day window above; exported for tests so the bucket math can be pinned
 * without a Prisma client.
 */
export function bucketDailySeries(
  from: Date,
  to: Date,
  rows: Array<{ processedAt: Date }>,
): Array<{ dayIso: string; count: number }> {
  const buckets = new Map<string, number>();
  for (let d = new Date(from); d < to; d.setUTCDate(d.getUTCDate() + 1)) {
    buckets.set(toDayKey(d), 0);
  }
  // Inclusive end: also seed today so today's events have a home.
  buckets.set(toDayKey(to), 0);

  for (const r of rows) {
    const key = toDayKey(r.processedAt);
    if (!buckets.has(key)) continue;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([dayIso, count]) => ({ dayIso, count }));
}

function toDayKey(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}
