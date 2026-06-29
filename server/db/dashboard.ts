import "server-only";

import { MemberRole, OutputStatus } from "@prisma/client";
import { requireRole, type TenantContext } from "@/server/auth/tenant";
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
  requireRole(ctx, READ_ROLES);
  return prisma.episode.count({
    where: {
      show: { client: { agencyId: ctx.agencyId } },
      createdAt: { gte: monthStart() },
    },
  });
}

export async function outputsGeneratedThisMonth(ctx: TenantContext): Promise<number> {
  requireRole(ctx, READ_ROLES);
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
  requireRole(ctx, READ_ROLES);
  return prisma.episode.count({
    where: {
      show: { client: { agencyId: ctx.agencyId } },
      createdAt: { gte: priorMonthStart(), lt: monthStart() },
    },
  });
}

export async function outputsGeneratedPriorMonth(ctx: TenantContext): Promise<number> {
  requireRole(ctx, READ_ROLES);
  return prisma.generatedOutput.count({
    where: {
      episode: { show: { client: { agencyId: ctx.agencyId } } },
      createdAt: { gte: priorMonthStart(), lt: monthStart() },
    },
  });
}

/**
 * Approval rate = approved ÷ (approved + ready + in_review) — looks only at
 * outputs that have reached a reviewable state. Generating + failed don't
 * count.
 */
export async function approvalRate(ctx: TenantContext): Promise<number> {
  requireRole(ctx, READ_ROLES);
  const [approved, eligible] = await Promise.all([
    prisma.generatedOutput.count({
      where: {
        episode: { show: { client: { agencyId: ctx.agencyId } } },
        status: OutputStatus.APPROVED,
      },
    }),
    prisma.generatedOutput.count({
      where: {
        episode: { show: { client: { agencyId: ctx.agencyId } } },
        status: { in: [OutputStatus.APPROVED, OutputStatus.READY, OutputStatus.IN_REVIEW] },
      },
    }),
  ]);
  if (eligible === 0) return 0;
  return Math.round((approved / eligible) * 100);
}

/**
 * "Posted with no edits" = approved outputs the user accepted exactly as
 * the model wrote them. Driven by `GeneratedOutput.editDistance` (cumulative
 * Levenshtein distance of every in-place edit), which 1.9 added — superseded
 * the prior `version == 1` proxy that mis-classified edited-then-approved
 * v1 rows as untouched.
 */
export async function percentPostedUnedited(ctx: TenantContext): Promise<number> {
  requireRole(ctx, READ_ROLES);
  const [approved, untouched] = await Promise.all([
    prisma.generatedOutput.count({
      where: {
        episode: { show: { client: { agencyId: ctx.agencyId } } },
        status: OutputStatus.APPROVED,
      },
    }),
    prisma.generatedOutput.count({
      where: {
        episode: { show: { client: { agencyId: ctx.agencyId } } },
        status: OutputStatus.APPROVED,
        editDistance: 0,
      },
    }),
  ]);
  if (approved === 0) return 0;
  return Math.round((untouched / approved) * 100);
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
  requireRole(ctx, READ_ROLES);

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
    if (row.status === OutputStatus.APPROVED) bucket.approved += 1;
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

export async function recentEpisodes(ctx: TenantContext, limit = 5) {
  requireRole(ctx, READ_ROLES);
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

// ============================================================
// Bundle helper — what the dashboard page needs in one call
// ============================================================

export async function dashboardSummary(ctx: TenantContext) {
  requireRole(ctx, READ_ROLES);
  const [
    episodesMonth,
    outputsMonth,
    episodesPrior,
    outputsPrior,
    approval,
    unedited,
    weekly12,
    recent,
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
  };
}

export { SHORT_MONTH };
