import "server-only";

import { MemberRole, OutputStatus } from "@prisma/client";
import { requireReadRole, type TenantContext } from "@/server/auth/tenant";
import {
  EDIT_TRACKING_SINCE,
  HEADLINE_WINDOW,
  POST_READY_MAX_RATIO,
} from "@/server/ai/voice-progress";
import { prisma } from "./client";

const READ_ROLES = [
  MemberRole.OWNER,
  MemberRole.ADMIN,
  MemberRole.EDITOR,
  MemberRole.REVIEWER,
] as const;

// ============================================================
// Helpers
// ============================================================

function monthStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function priorMonthStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() - 1, 1);
}

function weekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // Roll back to Monday — gives intuitive Mon-Sun weeks.
  const dow = d.getDay(); // 0 = Sun, 1 = Mon, …
  const diff = (dow + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

const SHORT_MONTH = new Intl.DateTimeFormat("en-US", { month: "short" });

// ============================================================
// KPI aggregates
// ============================================================

export async function episodesThisMonth(ctx: TenantContext): Promise<number> {
  requireReadRole(ctx, READ_ROLES);
  return prisma.episode.count({
    where: {
      show: { client: { agencyId: ctx.agencyId } },
      createdAt: { gte: monthStart() },
    },
  });
}

export async function outputsGeneratedThisMonth(ctx: TenantContext): Promise<number> {
  requireReadRole(ctx, READ_ROLES);
  return prisma.generatedOutput.count({
    where: {
      episode: { show: { client: { agencyId: ctx.agencyId } } },
      createdAt: { gte: monthStart() },
    },
  });
}

// ============================================================
// Prior-month aggregates (drive month-over-month deltas)
// ============================================================

export async function episodesPriorMonth(ctx: TenantContext): Promise<number> {
  requireReadRole(ctx, READ_ROLES);
  return prisma.episode.count({
    where: {
      show: { client: { agencyId: ctx.agencyId } },
      createdAt: { gte: priorMonthStart(), lt: monthStart() },
    },
  });
}

export async function outputsGeneratedPriorMonth(ctx: TenantContext): Promise<number> {
  requireReadRole(ctx, READ_ROLES);
  return prisma.generatedOutput.count({
    where: {
      episode: { show: { client: { agencyId: ctx.agencyId } } },
      createdAt: { gte: priorMonthStart(), lt: monthStart() },
    },
  });
}

/**
 * "Past-approval" statuses — every state a row can be in after the
 * internal team has signed off. Once approved, a row can be scheduled
 * and then published; both count as "approved" for KPI purposes.
 *
 * `AWAITING_CLIENT_APPROVAL` is deliberately excluded — the internal
 * team has passed it on but the client's decision is still pending, so
 * it isn't fully approved yet. This matches the KPI strip on
 * `/episodes/[id]`.
 */
const PAST_APPROVAL_STATUSES = [
  OutputStatus.APPROVED,
  OutputStatus.SCHEDULED,
  OutputStatus.PUBLISHED,
] as const;

/**
 * Approval rate = past-approval ÷ (past-approval + ready + in_review +
 * awaiting-client) — looks only at outputs that have reached a
 * reviewable state. Generating + failed don't count.
 *
 * We count anything the internal team has already approved, not just
 * the momentary `APPROVED` status, so the rate doesn't rewind to 0 as
 * scheduled / published rows accumulate.
 */
export async function approvalRate(ctx: TenantContext): Promise<number> {
  requireReadRole(ctx, READ_ROLES);
  const [approved, eligible] = await Promise.all([
    prisma.generatedOutput.count({
      where: {
        episode: { show: { client: { agencyId: ctx.agencyId } } },
        status: { in: [...PAST_APPROVAL_STATUSES] },
      },
    }),
    prisma.generatedOutput.count({
      where: {
        episode: { show: { client: { agencyId: ctx.agencyId } } },
        status: {
          in: [
            ...PAST_APPROVAL_STATUSES,
            OutputStatus.READY,
            OutputStatus.IN_REVIEW,
            OutputStatus.AWAITING_CLIENT_APPROVAL,
          ],
        },
      },
    }),
  ]);
  if (eligible === 0) return 0;
  return Math.round((approved / eligible) * 100);
}

/**
 * "% posted unedited" — the voice-engine north-star. Share of the
 * agency's last `HEADLINE_WINDOW` (30) shipped outputs whose
 * `editDistance / max(contentLength, 1)` sits at or below
 * `POST_READY_MAX_RATIO` (10%). This is the same definition
 * `<VoiceProgressCard>` renders per-show — dashboard hero and voice
 * page tell one story.
 *
 * Why the change from exact-zero:
 *   - A one-character typo fix used to disqualify an output from
 *     "unedited," which was noise dressed up as signal.
 *   - The voice card + drawer + PostHog `output_approved` event all use
 *     the ≤10% ratio; the dashboard KPI reporting exact-zero would
 *     silently contradict them.
 *
 * Why the change from lifetime to last-30:
 *   - Lifetime doesn't move once history dwarfs recent activity — a
 *     show that just crossed 90% post-ready would still show its 3-year
 *     average.
 *   - 30 rows is ~2 weeks at typical volume; enough to smooth a bad
 *     episode, small enough that improvement is visible.
 *
 * `EDIT_TRACKING_SINCE` guard: rows older than 2026-06-29 have
 * `editDistance = 0` because the column defaulted, not because they
 * shipped clean. Counting them would inflate the metric on shows with
 * pre-migration history.
 */
export async function percentPostedUnedited(ctx: TenantContext): Promise<number> {
  requireReadRole(ctx, READ_ROLES);
  const rows = await prisma.generatedOutput.findMany({
    where: {
      episode: { show: { client: { agencyId: ctx.agencyId } } },
      status: { in: [...PAST_APPROVAL_STATUSES] },
      supersededAt: null,
      createdAt: { gte: EDIT_TRACKING_SINCE },
    },
    select: { editDistance: true, content: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: HEADLINE_WINDOW,
  });
  if (rows.length === 0) return 0;
  const postReady = rows.filter((r) => {
    const len = Math.max(r.content.length, 1);
    const ratio = r.editDistance / len;
    return Number.isFinite(ratio) && ratio >= 0 && Math.min(1, ratio) <= POST_READY_MAX_RATIO;
  }).length;
  return Math.round((postReady / rows.length) * 100);
}

// ============================================================
// Weekly chart series
// ============================================================

export type WeeklyVolumePoint = {
  /** ISO date (Monday) marking the start of the bucket. */
  weekStart: string;
  generated: number;
  approved: number;
};

/**
 * Output volume bucketed by ISO week (Mon-Sun) for the most recent `weeks`
 * weeks. Returns oldest → newest.
 *
 * Strategy: pull all rows in the window, bucket in memory. With 7 outputs ×
 * a few episodes/week × <= 12 weeks this is at most a few hundred rows —
 * cheaper than pivoting in SQL and keeps the query portable.
 */
export async function weeklyOutputVolume(
  ctx: TenantContext,
  weeks = 8,
): Promise<WeeklyVolumePoint[]> {
  requireReadRole(ctx, READ_ROLES);

  const now = new Date();
  const startWeek = weekStart(new Date(now.getTime() - (weeks - 1) * 7 * 86_400_000));

  const rows = await prisma.generatedOutput.findMany({
    where: {
      episode: { show: { client: { agencyId: ctx.agencyId } } },
      createdAt: { gte: startWeek },
    },
    select: { createdAt: true, status: true },
  });

  // Initialise buckets so empty weeks still appear.
  const buckets = new Map<string, { generated: number; approved: number }>();
  for (let i = 0; i < weeks; i++) {
    const ws = new Date(startWeek);
    ws.setDate(startWeek.getDate() + i * 7);
    buckets.set(ws.toISOString(), { generated: 0, approved: 0 });
  }

  for (const row of rows) {
    const wkIso = weekStart(row.createdAt).toISOString();
    const bucket = buckets.get(wkIso);
    if (!bucket) continue;
    bucket.generated += 1;
    // "Approved" for the chart = past-approval statuses. Filtering by
    // the momentary APPROVED alone dropped everything the agency had
    // already scheduled or published, mis-reading the chart as if
    // approvals stopped.
    if (PAST_APPROVAL_STATUSES.includes(row.status as (typeof PAST_APPROVAL_STATUSES)[number])) {
      bucket.approved += 1;
    }
  }

  return Array.from(buckets.entries()).map(([weekStartIso, v]) => ({
    weekStart: weekStartIso,
    generated: v.generated,
    approved: v.approved,
  }));
}

// ============================================================
// Recent episodes for the dashboard list
// ============================================================

/**
 * Recent episodes for the dashboard list. Includes an ad-hoc
 * per-episode `pendingReviewCount` — the number of current-version
 * outputs still in READY / IN_REVIEW that the operator owes a decision
 * on. Prisma's `_count` with a where filter only accepts the relation
 * name (no arbitrary alias), so we resolve the extra count via a
 * separate `groupBy` and merge in memory rather than fetch full rows.
 */
export type RecentEpisodeRow = Awaited<ReturnType<typeof rawRecentEpisodes>>[number] & {
  pendingReviewCount: number;
};

async function rawRecentEpisodes(ctx: TenantContext, limit: number) {
  return prisma.episode.findMany({
    where: { show: { client: { agencyId: ctx.agencyId } } },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      show: {
        select: { name: true, host: true, client: { select: { name: true } } },
      },
      _count: { select: { outputs: true } },
    },
  });
}

export async function recentEpisodes(ctx: TenantContext, limit = 5): Promise<RecentEpisodeRow[]> {
  requireReadRole(ctx, READ_ROLES);
  const rows = await rawRecentEpisodes(ctx, limit);
  if (rows.length === 0) return [];

  const pendingByEpisode = await prisma.generatedOutput.groupBy({
    by: ["episodeId"],
    where: {
      episodeId: { in: rows.map((r) => r.id) },
      supersededAt: null,
      status: { in: [OutputStatus.READY, OutputStatus.IN_REVIEW] },
    },
    _count: { _all: true },
  });
  const pendingLookup = new Map<string, number>(
    pendingByEpisode.map((r) => [r.episodeId, r._count._all]),
  );

  return rows.map((r) => ({
    ...r,
    pendingReviewCount: pendingLookup.get(r.id) ?? 0,
  }));
}

/**
 * Agency-wide count of outputs the operator still owes a decision on
 * (current-version READY / IN_REVIEW rows). Powers the dashboard's
 * top "N outputs waiting for review" strip.
 */
export async function pendingReviewCount(ctx: TenantContext): Promise<number> {
  requireReadRole(ctx, READ_ROLES);
  return prisma.generatedOutput.count({
    where: {
      supersededAt: null,
      status: { in: [OutputStatus.READY, OutputStatus.IN_REVIEW] },
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
  });
}

// ============================================================
// Bundle helper — what the dashboard page needs in one call
// ============================================================

export async function dashboardSummary(ctx: TenantContext) {
  requireReadRole(ctx, READ_ROLES);
  const [
    episodesMonth,
    outputsMonth,
    episodesPrior,
    outputsPrior,
    approval,
    unedited,
    weekly12,
    recent,
    pendingReview,
  ] = await Promise.all([
    episodesThisMonth(ctx),
    outputsGeneratedThisMonth(ctx),
    episodesPriorMonth(ctx),
    outputsGeneratedPriorMonth(ctx),
    approvalRate(ctx),
    percentPostedUnedited(ctx),
    // Pull 12 weeks once and slice — both windows end at the current week,
    // so the last 8 buckets of the 12-week series ARE the 8-week series.
    weeklyOutputVolume(ctx, 12),
    recentEpisodes(ctx, 5),
    pendingReviewCount(ctx),
  ]);
  return {
    episodesMonth,
    outputsMonth,
    approval,
    unedited,
    weekly: weekly12.slice(-8),
    weekly12,
    recent,
    prior: { episodes: episodesPrior, outputs: outputsPrior },
    pendingReview,
  };
}

export { SHORT_MONTH };
