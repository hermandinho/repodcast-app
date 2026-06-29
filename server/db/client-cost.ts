import "server-only";

import { MemberRole, type Prisma } from "@prisma/client";
import { NotFoundError } from "@/server/auth/errors";
import { requireRole, type TenantContext } from "@/server/auth/tenant";
import { prisma } from "./client";

/**
 * Phase 2.13.5 — Cost-to-serve & profitability.
 *
 * Reads `UsageLog.costCents` joined through `Episode → Show → Client` so the
 * agency can see what each client cost to serve in a window, then crosses
 * that with the persisted `ClientBillingProfile.retainerCents` or
 * `ratePerEpisodeCents` × episode count to compute margin.
 *
 * Role gating: OWNER + ADMIN. Margin numbers are financial data — EDITOR
 * and REVIEWER don't see them.
 *
 * No schema change — every input row already exists (`UsageLog` is written
 * by the Inngest pipeline on every Claude call; `ClientBillingProfile` lands
 * in 2.13.1).
 */

const ADMIN_ROLES = [MemberRole.OWNER, MemberRole.ADMIN] as const;

// ============================================================
// Window helpers
// ============================================================

function monthStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function nextMonthStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

async function assertClientInTenant(ctx: TenantContext, clientId: string): Promise<void> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, agencyId: ctx.agencyId },
    select: { id: true },
  });
  if (!client) throw new NotFoundError(`Client ${clientId} not found`);
}

// ============================================================
// Per-client cost
// ============================================================

export type ClientCostResult = {
  costCents: number;
  episodeCountInWindow: number;
};

/**
 * Sum the cost-to-serve for `clientId` over `[from, to)`. Defaults to the
 * current calendar month if neither bound is supplied. `from` is inclusive,
 * `to` is exclusive — matches `planCapacity`'s month-window semantics.
 *
 * Also returns `episodeCountInWindow` so callers don't need a second query
 * to compute `revenue = ratePerEpisodeCents × episodes`.
 */
export async function costForClient(
  ctx: TenantContext,
  clientId: string,
  window?: { from?: Date; to?: Date },
): Promise<ClientCostResult> {
  requireRole(ctx, ADMIN_ROLES);
  await assertClientInTenant(ctx, clientId);

  const from = window?.from ?? monthStart();
  const to = window?.to ?? nextMonthStart();

  // Tenant + client + window — both queries share the shape so swapping
  // them on the cron / rollup paths stays trivial.
  const usageWhere: Prisma.UsageLogWhereInput = {
    agencyId: ctx.agencyId,
    createdAt: { gte: from, lt: to },
    episode: {
      show: { client: { id: clientId, agencyId: ctx.agencyId } },
    },
  };
  const episodeWhere: Prisma.EpisodeWhereInput = {
    show: { client: { id: clientId, agencyId: ctx.agencyId } },
    createdAt: { gte: from, lt: to },
  };

  const [usage, episodeCountInWindow] = await Promise.all([
    prisma.usageLog.aggregate({
      where: usageWhere,
      _sum: { costCents: true },
    }),
    prisma.episode.count({ where: episodeWhere }),
  ]);

  return {
    costCents: usage._sum.costCents ?? 0,
    episodeCountInWindow,
  };
}

// ============================================================
// Agency-wide rollup
// ============================================================

export type ClientCostRollupRow = {
  clientId: string;
  name: string;
  costCents: number;
  /** Episodes created in `[periodStart, periodEnd)` — drives rate-based revenue. */
  episodeCountInWindow: number;
  /** From `ClientBillingProfile.retainerCents`; null when no profile set. */
  retainerCents: number | null;
  /** From `ClientBillingProfile.ratePerEpisodeCents`; null when no profile set. */
  ratePerEpisodeCents: number | null;
  /**
   * Derived: retainer when present, else rate × episodeCount, else null.
   * Null when no billing profile is set — UI shows "—" for both revenue
   * and margin in that case.
   */
  revenueCents: number | null;
  /** Derived: `revenueCents - costCents`, or null when revenue is null. */
  marginCents: number | null;
};

/**
 * Per-client cost rollup across the agency for the given window. Three
 * `groupBy` queries (UsageLog → cost, Episode → episode count, Client →
 * names + billing profiles via include) so we don't fire per-row Prisma
 * calls in a loop.
 */
export async function costByClient(
  ctx: TenantContext,
  window?: { periodStart?: Date; periodEnd?: Date },
): Promise<ClientCostRollupRow[]> {
  requireRole(ctx, ADMIN_ROLES);

  const periodStart = window?.periodStart ?? monthStart();
  const periodEnd = window?.periodEnd ?? nextMonthStart();

  // 1. All clients in the agency + their billing profile (1:1, may be null).
  // 2. Cost per client: groupBy UsageLog on the show's client (Prisma can't
  //    groupBy on a relation, so we fan out via the parent client id by
  //    pulling UsageLog with the join, then accumulating in memory).
  // 3. Episode count per client across the window (same fan-out reason).
  const clients = await prisma.client.findMany({
    where: { agencyId: ctx.agencyId },
    orderBy: { name: "asc" },
    include: { billingProfile: true },
  });
  if (clients.length === 0) return [];

  const clientIds = clients.map((c) => c.id);

  const [usageRows, episodeRows] = await Promise.all([
    // Pulling one row per UsageLog isn't ideal at scale; we accept it for
    // v1 because monthly UsageLog counts are bounded by plan limits (~few
    // thousand per agency per month even at NETWORK). A nightly rollup
    // table is the eventual fix — already in the cross-cutting Operations
    // section of the plan.
    prisma.usageLog.findMany({
      where: {
        agencyId: ctx.agencyId,
        createdAt: { gte: periodStart, lt: periodEnd },
        episode: {
          show: { client: { agencyId: ctx.agencyId, id: { in: clientIds } } },
        },
      },
      select: {
        costCents: true,
        episode: { select: { show: { select: { clientId: true } } } },
      },
    }),
    prisma.episode.groupBy({
      by: ["showId"],
      where: {
        show: { client: { agencyId: ctx.agencyId, id: { in: clientIds } } },
        createdAt: { gte: periodStart, lt: periodEnd },
      },
      _count: { _all: true },
    }),
  ]);

  // Show → client lookup so we can roll episode counts up to the client.
  const shows = await prisma.show.findMany({
    where: { client: { agencyId: ctx.agencyId, id: { in: clientIds } } },
    select: { id: true, clientId: true },
  });
  const clientIdForShow = new Map<string, string>();
  for (const s of shows) clientIdForShow.set(s.id, s.clientId);

  const costByClientId = new Map<string, number>();
  for (const row of usageRows) {
    const cid = row.episode?.show.clientId;
    if (!cid) continue;
    costByClientId.set(cid, (costByClientId.get(cid) ?? 0) + row.costCents);
  }

  const episodesByClientId = new Map<string, number>();
  for (const row of episodeRows) {
    const cid = clientIdForShow.get(row.showId);
    if (!cid) continue;
    episodesByClientId.set(cid, (episodesByClientId.get(cid) ?? 0) + row._count._all);
  }

  return clients.map((c): ClientCostRollupRow => {
    const costCents = costByClientId.get(c.id) ?? 0;
    const episodeCountInWindow = episodesByClientId.get(c.id) ?? 0;
    const retainerCents = c.billingProfile?.retainerCents ?? null;
    const ratePerEpisodeCents = c.billingProfile?.ratePerEpisodeCents ?? null;
    let revenueCents: number | null = null;
    if (retainerCents != null && retainerCents > 0) {
      revenueCents = retainerCents;
    } else if (ratePerEpisodeCents != null && ratePerEpisodeCents > 0 && episodeCountInWindow > 0) {
      revenueCents = ratePerEpisodeCents * episodeCountInWindow;
    }
    const marginCents = revenueCents == null ? null : revenueCents - costCents;
    return {
      clientId: c.id,
      name: c.name,
      costCents,
      episodeCountInWindow,
      retainerCents,
      ratePerEpisodeCents,
      revenueCents,
      marginCents,
    };
  });
}
