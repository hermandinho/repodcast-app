import "server-only";

import { type MemberRole, type Plan, type Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { NotFoundError } from "@/server/auth/errors";
import { assertSystemRole, SYSTEM_READ_ROLES, type SystemAdminContext } from "@/server/auth/system";

/**
 * Repo helpers for the platform-admin agency surface. Distinct from the
 * tenant-scoped `server/db/agencies.ts`:
 *
 *   - These take a `SystemAdminContext`, never a `TenantContext`.
 *   - They never filter by `agencyId` (the whole point is the cross-tenant
 *     view), so the existing tenant-isolation tests don't apply here. The
 *     role gate ensures only platform admins can call.
 *   - Reads are open to every system role (ROOT / OPERATOR / SUPPORT /
 *     ANALYST). Writes (suspend, plan override, etc.) live in separate
 *     helpers wrapped with `withSystemAudit` — those land with subsequent
 *     ship-order slices.
 */

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;

export const listAgenciesForRootInput = z.object({
  search: z.string().trim().min(1).max(120).optional(),
  plan: z.enum(["STUDIO", "AGENCY", "NETWORK"]).optional(),
  /**
   * "active" excludes suspended rows; "suspended" only suspended; "all" both.
   * NOTE: `Agency.suspendedAt` lands in 3.6.5's write surface — until then
   * every row resolves to "active". We accept the param now so the URL
   * surface stays stable.
   */
  status: z.enum(["all", "active", "suspended"]).default("all"),
  /** Created-after lower bound (inclusive). */
  createdFrom: z.coerce.date().optional(),
  /** Created-before upper bound (inclusive, widened to end-of-day below). */
  createdTo: z.coerce.date().optional(),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  skip: z.coerce.number().int().min(0).default(0),
});
export type ListAgenciesForRootInput = z.infer<typeof listAgenciesForRootInput>;

export type AgencyRowForRoot = {
  id: string;
  name: string;
  plan: Plan;
  createdAt: Date;
  ownerEmail: string | null;
  ownerName: string | null;
  memberCount: number;
  episodesMtd: number;
  outputsMtd: number;
  costCentsMtd: number;
  lastActivityAt: Date | null;
  suspendedAt: Date | null;
};

export type AgencyDetailForRoot = {
  id: string;
  name: string;
  plan: Plan;
  createdAt: Date;
  updatedAt: Date;
  clerkOrgId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  preferredCurrency: string;
  brandLogoUrl: string | null;
  brandAccentColor: string | null;
  onboardingStep: string;
  renewalRemindersEnabled: boolean;
  /** Owner of the agency (first OWNER row). May be missing on misconfigured rows. */
  owner: { id: string; email: string; name: string | null } | null;
  /** Counts across the whole agency lifetime. */
  totals: {
    members: number;
    clients: number;
    shows: number;
    episodes: number;
    outputs: number;
    invoicesPaid: number;
  };
  /** Aggregates for the current calendar month. */
  monthToDate: {
    episodes: number;
    outputs: number;
    costCents: number;
    /** Sum of paid invoice amounts in the current month (cents). */
    revenueCents: number;
  };
  lastActivityAt: Date | null;
};

function monthStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function buildAgencyListWhere(input: ListAgenciesForRootInput): Prisma.AgencyWhereInput {
  const where: Prisma.AgencyWhereInput = {};
  if (input.search) {
    where.name = { contains: input.search, mode: "insensitive" };
  }
  if (input.plan) {
    where.plan = input.plan;
  }
  // `suspendedAt` field hasn't landed yet — we still build the WHERE in case a
  // later migration ships the column. Guarded with a typeof check so this
  // file stays building until the migration arrives.
  if (input.status === "active") {
    (where as Prisma.AgencyWhereInput & { suspendedAt?: unknown }).suspendedAt = null;
  } else if (input.status === "suspended") {
    (where as Prisma.AgencyWhereInput & { suspendedAt?: unknown }).suspendedAt = { not: null };
  }
  if (input.createdFrom || input.createdTo) {
    where.createdAt = {};
    if (input.createdFrom) where.createdAt.gte = input.createdFrom;
    if (input.createdTo) where.createdAt.lte = endOfDay(input.createdTo);
  }
  return where;
}

/**
 * Paginated agency table with per-row month-to-date aggregates. Built to
 * power `/root/agencies` — the row count is bounded by `take` (max 100) so
 * the per-page aggregate queries stay cheap. At higher scale this gets swapped
 * for an `AgencyUsageSnapshot` join (ship order step 4).
 */
export async function listAgenciesForRoot(
  ctx: SystemAdminContext,
  rawInput: Partial<ListAgenciesForRootInput> = {},
): Promise<{ rows: AgencyRowForRoot[]; total: number }> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const input = listAgenciesForRootInput.parse(rawInput);
  const where = buildAgencyListWhere(input);

  const [rawRows, total] = await Promise.all([
    prisma.agency.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: input.take,
      skip: input.skip,
      select: {
        id: true,
        name: true,
        plan: true,
        createdAt: true,
        members: {
          where: { role: "OWNER" },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: { email: true, name: true },
        },
        _count: { select: { members: true } },
      },
    }),
    prisma.agency.count({ where }),
  ]);

  if (rawRows.length === 0) return { rows: [], total };

  const agencyIds = rawRows.map((r) => r.id);
  const mtd = monthStart();

  const [episodesMtdByAgency, outputsMtdByAgency, costMtdByAgency, lastActivityByAgency] =
    await Promise.all([
      // Episodes created this month, grouped by tenant via the show->client join.
      prisma.episode.groupBy({
        by: ["showId"],
        where: {
          createdAt: { gte: mtd },
          show: { client: { agencyId: { in: agencyIds } } },
        },
        _count: { _all: true },
      }),
      // Outputs created this month — current version only.
      prisma.generatedOutput.groupBy({
        by: ["episodeId"],
        where: {
          createdAt: { gte: mtd },
          supersededAt: null,
          episode: { show: { client: { agencyId: { in: agencyIds } } } },
        },
        _count: { _all: true },
      }),
      // Anthropic spend this month — UsageLog is the only place with a
      // first-class agencyId column, so this is the cheap group.
      prisma.usageLog.groupBy({
        by: ["agencyId"],
        where: { agencyId: { in: agencyIds }, createdAt: { gte: mtd } },
        _sum: { costCents: true },
      }),
      // Most recent OutputTransition is the cleanest "last activity" signal —
      // it fires on every status flip including generation, approval, regen.
      prisma.outputTransition.groupBy({
        by: ["agencyId"],
        where: { agencyId: { in: agencyIds } },
        _max: { createdAt: true },
      }),
    ]);

  // Resolve the episode + output groupBys back to agencyId. The groupBy keys
  // are showId / episodeId, so we need a second small lookup. Cheaper than
  // pulling every row inline because we're aggregating before joining.
  const [showAgencyMap, episodeAgencyMap] = await Promise.all([
    resolveShowAgencyMap(episodesMtdByAgency.map((r) => r.showId)),
    resolveEpisodeAgencyMap(outputsMtdByAgency.map((r) => r.episodeId)),
  ]);

  const episodesMtd = bucketSumByAgency(
    episodesMtdByAgency,
    (r) => showAgencyMap.get(r.showId),
    (r) => r._count._all,
  );
  const outputsMtd = bucketSumByAgency(
    outputsMtdByAgency,
    (r) => episodeAgencyMap.get(r.episodeId),
    (r) => r._count._all,
  );
  const costMtd = new Map(costMtdByAgency.map((r) => [r.agencyId, r._sum.costCents ?? 0] as const));
  const lastActivity = new Map(
    lastActivityByAgency.map((r) => [r.agencyId, r._max.createdAt ?? null] as const),
  );

  const rows: AgencyRowForRoot[] = rawRows.map((r) => ({
    id: r.id,
    name: r.name,
    plan: r.plan,
    createdAt: r.createdAt,
    ownerEmail: r.members[0]?.email ?? null,
    ownerName: r.members[0]?.name ?? null,
    memberCount: r._count.members,
    episodesMtd: episodesMtd.get(r.id) ?? 0,
    outputsMtd: outputsMtd.get(r.id) ?? 0,
    costCentsMtd: costMtd.get(r.id) ?? 0,
    lastActivityAt: lastActivity.get(r.id) ?? null,
    suspendedAt: null,
  }));

  return { rows, total };
}

async function resolveShowAgencyMap(showIds: string[]): Promise<Map<string, string>> {
  if (showIds.length === 0) return new Map();
  const rows = await prisma.show.findMany({
    where: { id: { in: showIds } },
    select: { id: true, client: { select: { agencyId: true } } },
  });
  return new Map(rows.map((r) => [r.id, r.client.agencyId] as const));
}

async function resolveEpisodeAgencyMap(episodeIds: string[]): Promise<Map<string, string>> {
  if (episodeIds.length === 0) return new Map();
  const rows = await prisma.episode.findMany({
    where: { id: { in: episodeIds } },
    select: { id: true, show: { select: { client: { select: { agencyId: true } } } } },
  });
  return new Map(rows.map((r) => [r.id, r.show.client.agencyId] as const));
}

function bucketSumByAgency<T>(
  rows: T[],
  agencyIdOf: (row: T) => string | undefined,
  countOf: (row: T) => number,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const id = agencyIdOf(r);
    if (!id) continue;
    out.set(id, (out.get(id) ?? 0) + countOf(r));
  }
  return out;
}

/**
 * Single-row drilldown payload for `/root/agencies/[id]`. Tenant-free.
 * Returns `NotFoundError` if the id doesn't resolve — matches the tenant
 * repo convention even though ROOT could see the row anyway, because a
 * deleted-but-cached id should still 404.
 */
export async function getAgencyForRoot(
  ctx: SystemAdminContext,
  id: string,
): Promise<AgencyDetailForRoot> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const agency = await prisma.agency.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      plan: true,
      createdAt: true,
      updatedAt: true,
      clerkOrgId: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      preferredCurrency: true,
      brandLogoUrl: true,
      brandAccentColor: true,
      onboardingStep: true,
      renewalRemindersEnabled: true,
      members: {
        where: { role: "OWNER" },
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { id: true, email: true, name: true },
      },
      _count: {
        select: {
          members: true,
          clients: true,
          invoices: { where: { status: "PAID" } },
        },
      },
    },
  });

  if (!agency) throw new NotFoundError(`Agency ${id} not found`);

  const mtd = monthStart();

  const [
    showCount,
    episodeCount,
    currentOutputCount,
    episodesMtd,
    outputsMtd,
    costMtd,
    revenueMtd,
    lastActivity,
  ] = await Promise.all([
    prisma.show.count({ where: { client: { agencyId: id } } }),
    prisma.episode.count({ where: { show: { client: { agencyId: id } } } }),
    prisma.generatedOutput.count({
      where: { supersededAt: null, episode: { show: { client: { agencyId: id } } } },
    }),
    prisma.episode.count({
      where: {
        createdAt: { gte: mtd },
        show: { client: { agencyId: id } },
      },
    }),
    prisma.generatedOutput.count({
      where: {
        createdAt: { gte: mtd },
        supersededAt: null,
        episode: { show: { client: { agencyId: id } } },
      },
    }),
    prisma.usageLog.aggregate({
      where: { agencyId: id, createdAt: { gte: mtd } },
      _sum: { costCents: true },
    }),
    prisma.invoice.aggregate({
      where: { agencyId: id, status: "PAID", createdAt: { gte: mtd } },
      _sum: { amountCents: true },
    }),
    prisma.outputTransition.aggregate({
      where: { agencyId: id },
      _max: { createdAt: true },
    }),
  ]);

  const owner = agency.members[0] ?? null;

  return {
    id: agency.id,
    name: agency.name,
    plan: agency.plan,
    createdAt: agency.createdAt,
    updatedAt: agency.updatedAt,
    clerkOrgId: agency.clerkOrgId,
    stripeCustomerId: agency.stripeCustomerId,
    stripeSubscriptionId: agency.stripeSubscriptionId,
    preferredCurrency: agency.preferredCurrency,
    brandLogoUrl: agency.brandLogoUrl,
    brandAccentColor: agency.brandAccentColor,
    onboardingStep: agency.onboardingStep,
    renewalRemindersEnabled: agency.renewalRemindersEnabled,
    owner,
    totals: {
      members: agency._count.members,
      clients: agency._count.clients,
      shows: showCount,
      episodes: episodeCount,
      outputs: currentOutputCount,
      invoicesPaid: agency._count.invoices,
    },
    monthToDate: {
      episodes: episodesMtd,
      outputs: outputsMtd,
      costCents: costMtd._sum.costCents ?? 0,
      revenueCents: revenueMtd._sum.amountCents ?? 0,
    },
    lastActivityAt: lastActivity._max.createdAt ?? null,
  };
}

/**
 * Last N audit-log entries scoped to a single agency. Used by the drilldown's
 * Overview tab. Open to every read role.
 */
export async function listAgencyAuditEntries(
  ctx: SystemAdminContext,
  agencyId: string,
  limit = 10,
): Promise<
  Array<{
    id: string;
    action: string;
    note: string | null;
    createdAt: Date;
    actor: { email: string; name: string | null };
  }>
> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const rows = await prisma.systemAuditLog.findMany({
    where: { targetAgencyId: agencyId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 50),
    select: {
      id: true,
      action: true,
      note: true,
      createdAt: true,
      bySystemAdmin: { select: { email: true, name: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    note: r.note,
    createdAt: r.createdAt,
    actor: { email: r.bySystemAdmin.email, name: r.bySystemAdmin.name },
  }));
}

/**
 * Members of a single agency, ordered by role rank (OWNER → ADMIN → EDITOR
 * → REVIEWER) then most-recent activity. Used by the agency drilldown's
 * Overview tab to host the impersonation button per row.
 */
export type AgencyMemberForRoot = {
  id: string;
  email: string;
  name: string | null;
  role: MemberRole;
  createdAt: Date;
  /** Closest proxy for "last active" — the Member row's `updatedAt`. */
  updatedAt: Date;
};

export async function listAgencyMembers(
  ctx: SystemAdminContext,
  agencyId: string,
): Promise<AgencyMemberForRoot[]> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const rows = await prisma.member.findMany({
    where: { agencyId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const ROLE_RANK: Record<MemberRole, number> = {
    OWNER: 0,
    ADMIN: 1,
    EDITOR: 2,
    REVIEWER: 3,
  };

  return [...rows].sort((a, b) => {
    const r = ROLE_RANK[a.role] - ROLE_RANK[b.role];
    if (r !== 0) return r;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}
