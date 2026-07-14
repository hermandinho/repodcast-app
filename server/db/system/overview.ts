import "server-only";

import { type Plan, TranscriptSource } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { assertSystemRole, SYSTEM_READ_ROLES, type SystemAdminContext } from "@/server/auth/system";
import { PLAN_ORDER, priceFor } from "@/lib/plans";
import { utcDayStart } from "@/server/db/system/rollup";

/**
 * The numbers behind `/root` — the platform-overview dashboard.
 *
 * Implementation posture:
 *
 *   - Every aggregate is computed live on each request, no snapshot table.
 *     This is intentional. A later change swaps the hot paths to
 *     read from an `AgencyUsageSnapshot` rollup; until then we eat the cost
 *     of `groupBy`s on every page load. With < 1M output rows this is fine.
 *   - "Paying" means `stripeSubscriptionId IS NOT NULL`. An agency that
 *     signed up without going through Stripe (dev rows, comp accounts, the
 *     bootstrap) doesn't count toward MRR.
 *   - Cohort retention, MoM movement waterfall, and historic MRR series all
 *     live in `/root/finance`; the dashboard only
 *     surfaces today's numbers + a 12-week activity chart that doesn't need
 *     historic plan state.
 *
 * Everything below is open to every system read role (ROOT → ANALYST).
 */

export type RootOverview = {
  money: {
    /** Sum of paying-agency plan prices, USD cents. */
    mrrCents: number;
    /** mrrCents × 12. */
    arrCents: number;
    /**
     * Plan-price sum of paying agencies created this calendar month. A rough
     * proxy for "net new MRR"; doesn't yet net out cancellations or factor
     * upgrades since we lack a sub-state history table. Step 6 (finance
     * dashboard) replaces this with the real waterfall.
     */
    netNewMrrMtdCents: number;
    payingAgencies: number;
    nonPayingAgencies: number;
    agenciesCreatedMtd: number;
  };
  usage: {
    totalAgencies: number;
    totalMembers: number;
    episodesMtd: number;
    outputsMtd: number;
    /** Sum of `UsageLog.costCents` since month start. */
    aiSpendCentsMtd: number;
    /** MRR (cents) − AI spend MTD (cents). Negative = burning. */
    grossMarginCentsMtd: number;
  };
  health: {
    /** Episodes currently in PROCESSING. */
    inFlightEpisodes: number;
    /** OutputTransition rows landing in FAILED in the last 24h. */
    pipelineFailures24h: number;
    /** Episode rows with `status = FAILED` lifetime. */
    failedEpisodesLifetime: number;
    /** WebhookDelivery rows seen in the last 24h, grouped by source. */
    webhookDeliveries24h: Array<{ source: string; count: number }>;
  };
  charts: {
    /** Pie input — episodes by transcript source, lifetime. */
    episodesBySource: Array<{ source: TranscriptSource; count: number }>;
    /**
     * Stacked-bar input — last 12 weeks of current-version output volume,
     * bucketed by week-start (Monday UTC) and the agency's plan at write
     * time. We approximate "plan at write time" with the agency's current
     * plan; if a customer upgrades mid-month their historic bars retro-tag.
     * Acceptable for now since the chart is a workload signal, not a
     * billing artifact.
     */
    outputsByPlanLast12Weeks: Array<{
      weekStartIso: string;
      counts: Record<Plan, number>;
      total: number;
    }>;
  };
};

function monthStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function startOfWeekUTC(date: Date): Date {
  // Anchor to Monday 00:00 UTC. JS getUTCDay returns 0 (Sun) - 6 (Sat).
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  // Monday is the most globally-readable "week start" — calendar tools and
  // PostHog cohorts agree on this. Shift Sunday (0) back six days.
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function emptyPlanCounts(): Record<Plan, number> {
  return PLAN_ORDER.reduce(
    (acc, plan) => {
      acc[plan] = 0;
      return acc;
    },
    {} as Record<Plan, number>,
  );
}

/**
 * Snapshot-backed reads for the closed period, live aggregates for the open
 * period (today) — the canonical OLAP pattern. The hot paths used to run
 * `groupBy` over `GeneratedOutput` and `UsageLog` on every request; they
 * now read pre-aggregated `AgencyUsageSnapshot` rows for everything up to
 * yesterday EOD UTC and add a cheap live tail for today.
 *
 * MRR stays live (a tiny `Agency.groupBy(plan)` is essentially free and the
 * snapshot doesn't help). Pipeline / health metrics also stay live —
 * they're inherently 24h-windowed and don't benefit from rollup.
 *
 * Transition gotcha: the first time you run on production, snapshots are
 * empty. The dashboard will show low MTD numbers until the nightly cron
 * fires OR an operator dispatches a `system/rollup.backfill.requested`
 * event covering the back-history.
 */
export async function getRootOverview(ctx: SystemAdminContext): Promise<RootOverview> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const now = new Date();
  const ms = monthStart(now);
  const todayUtc = utcDayStart(now); // Open period: [todayUtc, now]
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  // 12 weeks back, anchored to the start of that calendar week so the
  // snapshot range lines up with the week buckets we render.
  const twelveWeeksAgo = startOfWeekUTC(new Date(now.getTime() - 11 * 7 * 24 * 60 * 60 * 1000));

  const [
    payingAgenciesByPlan,
    netNewByPlan,
    totalAgencies,
    totalMembers,
    snapshotMtd,
    todayEpisodes,
    todayOutputs,
    todayCost,
    inFlightEpisodes,
    pipelineFailures24h,
    failedEpisodesLifetime,
    webhookDeliveries24h,
    episodesBySource,
    snapshot12wRows,
  ] = await Promise.all([
    prisma.agency.groupBy({
      by: ["plan"],
      where: { stripeSubscriptionId: { not: null } },
      _count: { _all: true },
    }),
    prisma.agency.groupBy({
      by: ["plan"],
      where: {
        createdAt: { gte: ms },
        stripeSubscriptionId: { not: null },
      },
      _count: { _all: true },
    }),
    prisma.agency.count(),
    prisma.member.count(),
    // Snapshot-backed MTD: closed days only (yesterday and earlier).
    prisma.agencyUsageSnapshot.aggregate({
      where: { date: { gte: ms, lt: todayUtc } },
      _sum: { episodes: true, outputs: true, costCents: true },
    }),
    // Live tail for today — three cheap queries.
    prisma.episode.count({ where: { createdAt: { gte: todayUtc } } }),
    prisma.generatedOutput.count({
      where: { createdAt: { gte: todayUtc }, supersededAt: null },
    }),
    prisma.usageLog.aggregate({
      where: { createdAt: { gte: todayUtc } },
      _sum: { costCents: true },
    }),
    prisma.episode.count({ where: { status: "PROCESSING" } }),
    prisma.outputTransition.count({
      where: { toStatus: "FAILED", createdAt: { gte: dayAgo } },
    }),
    prisma.episode.count({ where: { status: "FAILED" } }),
    prisma.webhookDelivery.groupBy({
      by: ["source"],
      where: { processedAt: { gte: dayAgo } },
      _count: { _all: true },
    }),
    prisma.episode.groupBy({ by: ["source"], _count: { _all: true } }),
    // 12-week chart now sources from snapshots — one row per (agency, day)
    // already aggregated. Even at NETWORK scale this is bounded:
    // agencies × 84 days.
    prisma.agencyUsageSnapshot.findMany({
      where: { date: { gte: twelveWeeksAgo, lt: todayUtc } },
      select: { date: true, plan: true, outputs: true },
    }),
  ]);

  // Money rollup ------------------------------------------------------------

  const mrrCents = sumPlanPriceCents(payingAgenciesByPlan);
  const netNewMrrMtdCents = sumPlanPriceCents(netNewByPlan);
  const payingAgencies = payingAgenciesByPlan.reduce((acc, r) => acc + r._count._all, 0);
  const agenciesCreatedMtd = netNewByPlan.reduce((acc, r) => acc + r._count._all, 0);

  // Usage rollup ------------------------------------------------------------
  // Closed-period snapshot + live-today tail = full month-to-date.

  const closedEpisodes = snapshotMtd._sum.episodes ?? 0;
  const closedOutputs = snapshotMtd._sum.outputs ?? 0;
  const closedCost = snapshotMtd._sum.costCents ?? 0;

  const episodesMtd = closedEpisodes + todayEpisodes;
  const outputsMtd = closedOutputs + todayOutputs;
  const aiSpendCentsMtd = closedCost + (todayCost._sum.costCents ?? 0);
  const grossMarginCentsMtd = mrrCents - aiSpendCentsMtd;

  // 12-week stacked bar — bucket snapshot rows by week + plan. Today's
  // partial week is intentionally excluded (snapshot bound was `< todayUtc`);
  // the current week will appear partially filled, which is honest.

  const weekBuckets = build12WeekBuckets(now);
  for (const row of snapshot12wRows) {
    const weekKey = startOfWeekUTC(row.date).toISOString();
    const bucket = weekBuckets.get(weekKey);
    if (!bucket) continue;
    bucket.counts[row.plan] += row.outputs;
    bucket.total += row.outputs;
  }

  const outputsByPlanLast12Weeks = [...weekBuckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekStartIso, bucket]) => ({
      weekStartIso,
      counts: bucket.counts,
      total: bucket.total,
    }));

  // Episodes-by-source pivot ------------------------------------------------

  const episodesBySourcePivot = TRANSCRIPT_SOURCES.map((source) => ({
    source,
    count: episodesBySource.find((r) => r.source === source)?._count._all ?? 0,
  }));

  return {
    money: {
      mrrCents,
      arrCents: mrrCents * 12,
      netNewMrrMtdCents,
      payingAgencies,
      nonPayingAgencies: totalAgencies - payingAgencies,
      agenciesCreatedMtd,
    },
    usage: {
      totalAgencies,
      totalMembers,
      episodesMtd,
      outputsMtd,
      aiSpendCentsMtd,
      grossMarginCentsMtd,
    },
    health: {
      inFlightEpisodes,
      pipelineFailures24h,
      failedEpisodesLifetime,
      webhookDeliveries24h: webhookDeliveries24h
        .map((r) => ({ source: r.source, count: r._count._all }))
        .sort((a, b) => b.count - a.count),
    },
    charts: {
      episodesBySource: episodesBySourcePivot,
      outputsByPlanLast12Weeks,
    },
  };
}

const TRANSCRIPT_SOURCES: readonly TranscriptSource[] = [
  TranscriptSource.PASTE,
  TranscriptSource.UPLOAD,
  TranscriptSource.RSS,
  TranscriptSource.YOUTUBE,
];

function sumPlanPriceCents(rows: Array<{ plan: Plan; _count: { _all: number } }>): number {
  return rows.reduce((acc, r) => acc + priceFor(r.plan) * 100 * r._count._all, 0);
}

/**
 * Produce 12 chronological week buckets ending on the week containing `now`.
 * Each bucket starts on a Monday UTC and carries a zero-filled per-plan
 * counter object so the chart layer can render even weeks with no activity.
 *
 * Exported for tests so the bucket math can be pinned without spinning up a
 * Prisma client.
 */
export function build12WeekBuckets(
  now: Date,
): Map<string, { counts: Record<Plan, number>; total: number }> {
  const buckets = new Map<string, { counts: Record<Plan, number>; total: number }>();
  const currentWeek = startOfWeekUTC(now);
  for (let i = 11; i >= 0; i--) {
    const start = new Date(currentWeek);
    start.setUTCDate(start.getUTCDate() - i * 7);
    buckets.set(start.toISOString(), { counts: emptyPlanCounts(), total: 0 });
  }
  return buckets;
}
