import "server-only";

import {
  type BillingCadence,
  type MemberRole,
  type Plan,
  type Prisma,
  TrialStatus,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { NotFoundError, ValidationError } from "@/server/auth/errors";
import {
  assertSystemRole,
  SYSTEM_READ_ROLES,
  SYSTEM_ROOT_ONLY,
  SYSTEM_WRITE_ROLES,
  type SystemAdminContext,
} from "@/server/auth/system";
import { requireStripeClient } from "@/server/billing/stripe";
import { getR2Client, quarantineR2AgencyPrefixes } from "@/server/storage/r2";
import { SYSTEM_AUDIT_ACTIONS } from "./audit-actions";
import { withSystemAudit } from "./audit";

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
  plan: z.enum(["SOLO", "STUDIO", "AGENCY", "NETWORK"]).optional(),
  /**
   * "active" excludes suspended rows; "suspended" only suspended; "all" both.
   * NOTE: `Agency.suspendedAt` lands in 3.6.5's write surface — until then
   * every row resolves to "active". We accept the param now so the URL
   * surface stays stable.
   */
  status: z.enum(["all", "active", "suspended"]).default("all"),
  /**
   * Phase 3.9 — filter by TrialStatus. Defaults to "all" so operators land on
   * the full list; the ROOT list page adds a chip for the "currently on trial"
   * view (maps to "active").
   */
  trial: z.enum(["all", "active", "converted", "expired", "canceled"]).default("all"),
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
  trialStatus: TrialStatus;
  trialEndsAt: Date | null;
};

export type AgencyDetailForRoot = {
  id: string;
  name: string;
  plan: Plan;
  /** Non-null when a ROOT-side plan override is in effect. */
  planOverride: Plan | null;
  /** Non-null while a ROOT-granted free-access window is in effect. A past
   *  value means the comp has expired and the standard gate applies again. */
  compAccessExpiresAt: Date | null;
  /** Non-null when the agency is suspended. Tenant dashboard bounces on this. */
  suspendedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  clerkOrgId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  /** Monthly or annual — mirrored from the Stripe Price on the sub. */
  billingCadence: BillingCadence;
  /** Non-null when Stripe reports `cancel_at_period_end: true`. Matches the
   *  timestamp used by the tenant billing page's cancel-scheduled banner. */
  subscriptionCancelAt: Date | null;
  preferredCurrency: string;
  brandLogoUrl: string | null;
  brandAccentColor: string | null;
  renewalRemindersEnabled: boolean;
  /** Phase 3.9 — trial lifecycle. Surfaces the extend-trial action + the
   *  status pill on the ROOT drilldown. */
  trialStatus: TrialStatus;
  trialEndsAt: Date | null;
  /** Currently attached Stripe Coupon on the sub (custom-priced deals).
   *  Populated by the Stripe webhook; surfaces on the ROOT drilldown so an
   *  operator can see + revoke the discount without hopping to Stripe. */
  activeDiscountLabel: string | null;
  activeDiscountEndsAt: Date | null;
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
  if (input.trial !== "all") {
    // Map the URL param to the DB enum. Uppercase-conversion keeps the URL
    // clean (`?trial=active` reads better than `?trial=ACTIVE`).
    where.trialStatus = input.trial.toUpperCase() as TrialStatus;
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
        trialStatus: true,
        trialEndsAt: true,
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
    trialStatus: r.trialStatus,
    trialEndsAt: r.trialEndsAt,
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
      planOverride: true,
      compAccessExpiresAt: true,
      suspendedAt: true,
      createdAt: true,
      updatedAt: true,
      clerkOrgId: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      billingCadence: true,
      subscriptionCancelAt: true,
      preferredCurrency: true,
      brandLogoUrl: true,
      brandAccentColor: true,
      renewalRemindersEnabled: true,
      trialStatus: true,
      trialEndsAt: true,
      activeDiscountLabel: true,
      activeDiscountEndsAt: true,
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
    planOverride: agency.planOverride,
    compAccessExpiresAt: agency.compAccessExpiresAt,
    suspendedAt: agency.suspendedAt,
    createdAt: agency.createdAt,
    updatedAt: agency.updatedAt,
    clerkOrgId: agency.clerkOrgId,
    stripeCustomerId: agency.stripeCustomerId,
    stripeSubscriptionId: agency.stripeSubscriptionId,
    billingCadence: agency.billingCadence,
    subscriptionCancelAt: agency.subscriptionCancelAt,
    preferredCurrency: agency.preferredCurrency,
    brandLogoUrl: agency.brandLogoUrl,
    brandAccentColor: agency.brandAccentColor,
    renewalRemindersEnabled: agency.renewalRemindersEnabled,
    trialStatus: agency.trialStatus,
    trialEndsAt: agency.trialEndsAt,
    activeDiscountLabel: agency.activeDiscountLabel,
    activeDiscountEndsAt: agency.activeDiscountEndsAt,
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

// ============================================================
// Write helpers — Phase 3.6.5 ROOT-side actions
// ============================================================
//
// Every write funnels through `withSystemAudit` — one prisma.$transaction
// per action, audit row inserted at the end of the same TX as the mutation.
// Role gated to SYSTEM_WRITE_ROLES (ROOT + OPERATOR); SUPPORT / ANALYST get
// ForbiddenError before any DB touch.
//
// Stripe-facing paths (`forceCancelAgencySubscription`) fire the Stripe API
// call INSIDE the wrapper. That holds the DB TX open across a network call,
// which is only acceptable for rare admin actions — never wire this pattern
// into a hot request path.

const PLAN_VALUES = ["SOLO", "STUDIO", "AGENCY", "NETWORK"] as const;

export const suspendAgencyInput = z.object({
  id: z.string().trim().min(1),
  /** Required — audit note explaining WHY the agency is being suspended. */
  note: z.string().trim().min(3).max(500),
});
export type SuspendAgencyInput = z.input<typeof suspendAgencyInput>;

export async function suspendAgency(
  ctx: SystemAdminContext,
  rawInput: SuspendAgencyInput,
): Promise<void> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = suspendAgencyInput.parse(rawInput);

  await withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.AGENCY_SUSPEND,
      targetAgencyId: input.id,
      note: input.note,
    },
    async (tx, audit) => {
      const before = await tx.agency.findUnique({
        where: { id: input.id },
        select: { id: true, name: true, plan: true, suspendedAt: true },
      });
      if (!before) throw new NotFoundError(`Agency ${input.id} not found`);
      if (before.suspendedAt !== null) {
        throw new ValidationError(`Agency ${input.id} is already suspended`);
      }
      audit.setBefore(before);

      const after = await tx.agency.update({
        where: { id: input.id },
        data: { suspendedAt: new Date() },
        select: { id: true, name: true, plan: true, suspendedAt: true },
      });
      audit.setAfter(after);
    },
  );
}

export const unsuspendAgencyInput = z.object({
  id: z.string().trim().min(1),
  note: z.string().trim().min(3).max(500),
});
export type UnsuspendAgencyInput = z.input<typeof unsuspendAgencyInput>;

export async function unsuspendAgency(
  ctx: SystemAdminContext,
  rawInput: UnsuspendAgencyInput,
): Promise<void> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = unsuspendAgencyInput.parse(rawInput);

  await withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.AGENCY_UNSUSPEND,
      targetAgencyId: input.id,
      note: input.note,
    },
    async (tx, audit) => {
      const before = await tx.agency.findUnique({
        where: { id: input.id },
        select: { id: true, name: true, suspendedAt: true },
      });
      if (!before) throw new NotFoundError(`Agency ${input.id} not found`);
      if (before.suspendedAt === null) {
        throw new ValidationError(`Agency ${input.id} isn't currently suspended`);
      }
      audit.setBefore(before);

      const after = await tx.agency.update({
        where: { id: input.id },
        data: { suspendedAt: null },
        select: { id: true, name: true, suspendedAt: true },
      });
      audit.setAfter(after);
    },
  );
}

export const grantAgencyPlanOverrideInput = z.object({
  id: z.string().trim().min(1),
  plan: z.enum(PLAN_VALUES),
  /** Required — audit note ("comp partner", "beta trial", "support case 123"). */
  note: z.string().trim().min(3).max(500),
});
export type GrantAgencyPlanOverrideInput = z.input<typeof grantAgencyPlanOverrideInput>;

export async function grantAgencyPlanOverride(
  ctx: SystemAdminContext,
  rawInput: GrantAgencyPlanOverrideInput,
): Promise<void> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = grantAgencyPlanOverrideInput.parse(rawInput);

  await withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.AGENCY_GRANT_PLAN_OVERRIDE,
      targetAgencyId: input.id,
      note: input.note,
    },
    async (tx, audit) => {
      const before = await tx.agency.findUnique({
        where: { id: input.id },
        select: { id: true, name: true, plan: true, planOverride: true },
      });
      if (!before) throw new NotFoundError(`Agency ${input.id} not found`);
      audit.setBefore(before);

      const after = await tx.agency.update({
        where: { id: input.id },
        data: { planOverride: input.plan },
        select: { id: true, name: true, plan: true, planOverride: true },
      });
      audit.setAfter(after);
    },
  );
}

export const revokeAgencyPlanOverrideInput = z.object({
  id: z.string().trim().min(1),
  note: z.string().trim().min(3).max(500),
});
export type RevokeAgencyPlanOverrideInput = z.input<typeof revokeAgencyPlanOverrideInput>;

export async function revokeAgencyPlanOverride(
  ctx: SystemAdminContext,
  rawInput: RevokeAgencyPlanOverrideInput,
): Promise<void> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = revokeAgencyPlanOverrideInput.parse(rawInput);

  await withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.AGENCY_REVOKE_PLAN_OVERRIDE,
      targetAgencyId: input.id,
      note: input.note,
    },
    async (tx, audit) => {
      const before = await tx.agency.findUnique({
        where: { id: input.id },
        select: { id: true, name: true, plan: true, planOverride: true },
      });
      if (!before) throw new NotFoundError(`Agency ${input.id} not found`);
      if (before.planOverride === null) {
        throw new ValidationError(`Agency ${input.id} has no active plan override`);
      }
      audit.setBefore(before);

      const after = await tx.agency.update({
        where: { id: input.id },
        data: { planOverride: null },
        select: { id: true, name: true, plan: true, planOverride: true },
      });
      audit.setAfter(after);
    },
  );
}

// ============================================================
// Comp access — free dashboard access, no Stripe sub required.
// ============================================================
//
// A ROOT-granted `Agency.compAccessExpiresAt` is treated as an equivalent
// signal to `stripeSubscriptionId` by the three access gates:
//
//   - `getOnboardingStateForUser` — routes to /dashboard instead of /plan
//   - dashboard layout — lets the request through
//   - `assertActiveSubscription` — accepts writes
//
// Grants are always time-boxed (1..3650 days) so a comp doesn't become
// permanent by accident. Operators can extend or revoke at any time.

/** Upper bound for a single grant / extension. Ten years is functionally
 * "indefinite" but forces a re-audit if we ever want longer. */
const COMP_ACCESS_MAX_DAYS = 3650;

export const grantAgencyCompAccessInput = z.object({
  id: z.string().trim().min(1),
  /** Length of the comp window from now, in days. */
  durationDays: z.coerce.number().int().min(1).max(COMP_ACCESS_MAX_DAYS),
  /** Required — audit note (partner deal, internal demo, support case ...). */
  note: z.string().trim().min(3).max(500),
});
export type GrantAgencyCompAccessInput = z.input<typeof grantAgencyCompAccessInput>;

/**
 * Grant a fresh comp window. Overwrites any existing `compAccessExpiresAt`
 * outright — `extendAgencyCompAccess` is the additive variant. Same-TX audit
 * row lands `before`/`after` snapshots so the log records what got clobbered.
 */
export async function grantAgencyCompAccess(
  ctx: SystemAdminContext,
  rawInput: GrantAgencyCompAccessInput,
): Promise<{ compAccessExpiresAt: Date }> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = grantAgencyCompAccessInput.parse(rawInput);

  const newExpiry = new Date(Date.now() + input.durationDays * 86_400_000);
  await withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.AGENCY_GRANT_COMP_ACCESS,
      targetAgencyId: input.id,
      note: input.note,
    },
    async (tx, audit) => {
      const before = await tx.agency.findUnique({
        where: { id: input.id },
        select: { id: true, name: true, compAccessExpiresAt: true },
      });
      if (!before) throw new NotFoundError(`Agency ${input.id} not found`);
      audit.setBefore(before);

      const after = await tx.agency.update({
        where: { id: input.id },
        data: { compAccessExpiresAt: newExpiry },
        select: { id: true, name: true, compAccessExpiresAt: true },
      });
      audit.setAfter(after);
    },
  );
  return { compAccessExpiresAt: newExpiry };
}

export const extendAgencyCompAccessInput = z.object({
  id: z.string().trim().min(1),
  /** Days added to the current `compAccessExpiresAt`. If the current value is
   *  null OR already in the past, extension is measured from `now` instead. */
  additionalDays: z.coerce.number().int().min(1).max(COMP_ACCESS_MAX_DAYS),
  note: z.string().trim().min(3).max(500),
});
export type ExtendAgencyCompAccessInput = z.input<typeof extendAgencyCompAccessInput>;

/**
 * Push `compAccessExpiresAt` further into the future by N days. Rebases off
 * `now` when the current comp has already lapsed so an extension always
 * results in a live window (rather than a still-past date).
 */
export async function extendAgencyCompAccess(
  ctx: SystemAdminContext,
  rawInput: ExtendAgencyCompAccessInput,
): Promise<{ compAccessExpiresAt: Date }> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = extendAgencyCompAccessInput.parse(rawInput);

  let newExpiry: Date | null = null;

  await withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.AGENCY_EXTEND_COMP_ACCESS,
      targetAgencyId: input.id,
      note: input.note,
    },
    async (tx, audit) => {
      const before = await tx.agency.findUnique({
        where: { id: input.id },
        select: { id: true, name: true, compAccessExpiresAt: true },
      });
      if (!before) throw new NotFoundError(`Agency ${input.id} not found`);
      audit.setBefore(before);

      const base =
        before.compAccessExpiresAt && before.compAccessExpiresAt.getTime() > Date.now()
          ? before.compAccessExpiresAt
          : new Date();
      newExpiry = new Date(base.getTime() + input.additionalDays * 86_400_000);

      const after = await tx.agency.update({
        where: { id: input.id },
        data: { compAccessExpiresAt: newExpiry },
        select: { id: true, name: true, compAccessExpiresAt: true },
      });
      audit.setAfter(after);
    },
  );
  // newExpiry is always assigned inside the audit callback above; the
  // non-null assertion is safe once the TX has committed successfully.
  return { compAccessExpiresAt: newExpiry! };
}

export const revokeAgencyCompAccessInput = z.object({
  id: z.string().trim().min(1),
  note: z.string().trim().min(3).max(500),
});
export type RevokeAgencyCompAccessInput = z.input<typeof revokeAgencyCompAccessInput>;

/**
 * Immediately end the comp window by nulling `compAccessExpiresAt`. The
 * agency snaps back to the standard Stripe-gated flow on the next request.
 * Errors if there was nothing active to revoke (matches the pattern used by
 * `revokeAgencyPlanOverride`).
 */
export async function revokeAgencyCompAccess(
  ctx: SystemAdminContext,
  rawInput: RevokeAgencyCompAccessInput,
): Promise<void> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = revokeAgencyCompAccessInput.parse(rawInput);

  await withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.AGENCY_REVOKE_COMP_ACCESS,
      targetAgencyId: input.id,
      note: input.note,
    },
    async (tx, audit) => {
      const before = await tx.agency.findUnique({
        where: { id: input.id },
        select: { id: true, name: true, compAccessExpiresAt: true },
      });
      if (!before) throw new NotFoundError(`Agency ${input.id} not found`);
      if (before.compAccessExpiresAt === null) {
        throw new ValidationError(`Agency ${input.id} has no active comp access`);
      }
      audit.setBefore(before);

      const after = await tx.agency.update({
        where: { id: input.id },
        data: { compAccessExpiresAt: null },
        select: { id: true, name: true, compAccessExpiresAt: true },
      });
      audit.setAfter(after);
    },
  );
}

export const forceCancelAgencySubscriptionInput = z.object({
  id: z.string().trim().min(1),
  /** Required — audit-only note. */
  note: z.string().trim().min(3).max(500),
});
export type ForceCancelAgencySubscriptionInput = z.input<typeof forceCancelAgencySubscriptionInput>;

/**
 * Cancel the agency's Stripe subscription with `invoice_now: true, prorate: true`
 * and downgrade the local row to STUDIO in the same TX. Idempotent — if the
 * Stripe subscription is already canceled, Stripe returns the canceled object
 * without erroring.
 *
 * The Stripe call runs INSIDE the audit TX so a failure rolls everything
 * back — no orphan mutation, no orphan audit row. Only acceptable because
 * this is a rare, human-initiated admin action.
 */
export async function forceCancelAgencySubscription(
  ctx: SystemAdminContext,
  rawInput: ForceCancelAgencySubscriptionInput,
): Promise<void> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = forceCancelAgencySubscriptionInput.parse(rawInput);

  // Pre-flight: fetch the subscription id + surface a clear error if there
  // isn't one before opening any TX or touching Stripe.
  const agency = await prisma.agency.findUnique({
    where: { id: input.id },
    select: { id: true, name: true, plan: true, stripeSubscriptionId: true },
  });
  if (!agency) throw new NotFoundError(`Agency ${input.id} not found`);
  if (!agency.stripeSubscriptionId) {
    throw new ValidationError(`Agency ${input.id} has no active Stripe subscription`);
  }

  const stripe = requireStripeClient();

  await withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.SUBSCRIPTION_FORCE_CANCEL,
      targetAgencyId: input.id,
      note: input.note,
    },
    async (tx, audit) => {
      audit.setBefore({
        agencyId: agency.id,
        stripeSubscriptionId: agency.stripeSubscriptionId,
        plan: agency.plan,
      });

      // subscriptions.cancel is idempotent — a re-cancel returns the
      // already-canceled sub. Both `invoice_now` and `prorate` are safe
      // no-ops when the sub is already terminal.
      const canceled = await stripe.subscriptions.cancel(agency.stripeSubscriptionId!, {
        invoice_now: true,
        prorate: true,
      });

      // Downgrade locally right away so the tenant sees the change without
      // waiting on the webhook. The `customer.subscription.deleted` handler
      // will re-run this same write idempotently.
      await tx.agency.update({
        where: { id: input.id },
        data: {
          plan: "STUDIO",
          billingCadence: "MONTHLY",
          stripeSubscriptionId: null,
        },
      });

      audit.setAfter({
        agencyId: agency.id,
        stripeSubscriptionId: canceled.id,
        stripeStatus: canceled.status,
        canceledAt: canceled.canceled_at,
      });
    },
  );
}

export const extendAgencyTrialInput = z.object({
  id: z.string().trim().min(1),
  /** Additional days on top of the current `trialEndsAt`. 1..30 to keep abuse bounded. */
  additionalDays: z.coerce.number().int().min(1).max(30),
  /** Required — audit-only note explaining why. */
  note: z.string().trim().min(3).max(500),
});
export type ExtendAgencyTrialInput = z.input<typeof extendAgencyTrialInput>;

/**
 * Phase 3.9 — extend an ACTIVE trial by N days. Updates both Stripe (source of
 * truth for the day-15 charge attempt) and the local `Agency.trialEndsAt`
 * mirror in the same audit TX so a Stripe failure rolls the mirror back.
 *
 * Guardrails:
 *   - Only agencies whose `trialStatus === ACTIVE` are eligible. EXPIRED /
 *     CONVERTED / CANCELED all reject with `ValidationError`.
 *   - Additional days capped at 30 to bound the "give the customer 6 months
 *     free" foot-gun.
 */
export async function extendAgencyTrial(
  ctx: SystemAdminContext,
  rawInput: ExtendAgencyTrialInput,
): Promise<{ newTrialEndsAt: Date }> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = extendAgencyTrialInput.parse(rawInput);

  const agency = await prisma.agency.findUnique({
    where: { id: input.id },
    select: {
      id: true,
      name: true,
      trialStatus: true,
      trialEndsAt: true,
      stripeSubscriptionId: true,
    },
  });
  if (!agency) throw new NotFoundError(`Agency ${input.id} not found`);
  if (agency.trialStatus !== TrialStatus.ACTIVE) {
    throw new ValidationError(
      `Agency ${input.id} is not on an active trial (status: ${agency.trialStatus})`,
    );
  }
  if (!agency.trialEndsAt) {
    throw new ValidationError(`Agency ${input.id} has no trialEndsAt to extend`);
  }
  if (!agency.stripeSubscriptionId) {
    throw new ValidationError(`Agency ${input.id} has no live Stripe subscription`);
  }

  const currentEnd = agency.trialEndsAt;
  const newEnd = new Date(currentEnd.getTime() + input.additionalDays * 86_400_000);

  const stripe = requireStripeClient();

  await withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.SUBSCRIPTION_EXTEND_TRIAL,
      targetAgencyId: input.id,
      note: input.note,
    },
    async (tx, audit) => {
      audit.setBefore({
        agencyId: agency.id,
        trialEndsAt: currentEnd.toISOString(),
        additionalDays: input.additionalDays,
      });

      // Stripe: `trial_end` is a unix timestamp. `proration_behavior: "none"`
      // avoids issuing a proration line item for the shifted window.
      await stripe.subscriptions.update(agency.stripeSubscriptionId!, {
        trial_end: Math.floor(newEnd.getTime() / 1000),
        proration_behavior: "none",
      });

      // Mirror the new end date. The webhook's `subscription.updated` handler
      // would eventually resync this too, but we write it here so the ROOT UI
      // reflects the change without a race.
      await tx.agency.update({
        where: { id: input.id },
        data: { trialEndsAt: newEnd },
      });

      audit.setAfter({ agencyId: agency.id, trialEndsAt: newEnd.toISOString() });
    },
  );

  return { newTrialEndsAt: newEnd };
}

// ============================================================
// Discount attach / remove (custom-priced launch deals)
// ============================================================
//
// Attaches a Stripe Coupon to an agency's live subscription by resolving a
// Promotion Code (the human-facing "LAUNCH-ACME" string) to its Stripe id
// and calling `subscriptions.update({ discounts: [{ promotion_code }] })`.
//
// The Stripe call runs INSIDE the audit TX so a Stripe failure rolls the
// audit row back — no orphan grant, no orphan log. Same "acceptable
// because it's rare + human-initiated" caveat as `forceCancelAgencySubscription`.
//
// The `customer.subscription.updated` webhook picks up the mutation and
// stamps `activeDiscountLabel` + `activeDiscountEndsAt` via `syncSubscription`.
// We also write those two columns eagerly here so the ROOT drilldown +
// tenant billing page reflect the grant on next paint without waiting for
// the webhook round-trip.

export const applyAgencyDiscountInput = z.object({
  id: z.string().trim().min(1),
  /** Human promotion code the operator got from the client (e.g. "LAUNCH-ACME").
   *  Case-insensitive on Stripe's side; upstream stored/matched in uppercase. */
  promotionCode: z.string().trim().min(1).max(120),
  /** Required — audit note referencing the deal ("call w/ Acme 2026-07-10"). */
  note: z.string().trim().min(3).max(500),
});
export type ApplyAgencyDiscountInput = z.input<typeof applyAgencyDiscountInput>;

export async function applyAgencyDiscount(
  ctx: SystemAdminContext,
  rawInput: ApplyAgencyDiscountInput,
): Promise<{ couponLabel: string; endsAt: Date | null }> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = applyAgencyDiscountInput.parse(rawInput);

  const agency = await prisma.agency.findUnique({
    where: { id: input.id },
    select: {
      id: true,
      name: true,
      stripeSubscriptionId: true,
      activeDiscountLabel: true,
      activeDiscountEndsAt: true,
    },
  });
  if (!agency) throw new NotFoundError(`Agency ${input.id} not found`);
  if (!agency.stripeSubscriptionId) {
    throw new ValidationError(
      `Agency ${input.id} has no active Stripe subscription — a discount can only attach to a live sub.`,
    );
  }

  const stripe = requireStripeClient();

  // Resolve the human code → Stripe id. Only active codes are considered so
  // an expired / archived code fails cleanly rather than silently attaching
  // an unusable discount. Codes are unique per code+active combo, so list
  // limit=1 is enough.
  const promoLookup = await stripe.promotionCodes.list({
    code: input.promotionCode.trim(),
    active: true,
    limit: 1,
    expand: ["data.promotion.coupon"],
  });
  const promo = promoLookup.data[0];
  if (!promo) {
    throw new ValidationError(
      `No active Stripe promotion code matches "${input.promotionCode}". Check the code or activate it in the Stripe dashboard first.`,
    );
  }
  const promoCoupon =
    promo.promotion.coupon && typeof promo.promotion.coupon !== "string"
      ? promo.promotion.coupon
      : null;

  let resolvedLabel = "";
  let resolvedEndsAt: Date | null = null;

  await withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.SUBSCRIPTION_APPLY_DISCOUNT,
      targetAgencyId: input.id,
      note: input.note,
    },
    async (tx, audit) => {
      audit.setBefore({
        stripeSubscriptionId: agency.stripeSubscriptionId,
        activeDiscountLabel: agency.activeDiscountLabel,
        activeDiscountEndsAt: agency.activeDiscountEndsAt?.toISOString() ?? null,
      });

      const updated = await stripe.subscriptions.update(agency.stripeSubscriptionId!, {
        discounts: [{ promotion_code: promo.id }],
        expand: ["discounts.source.coupon"],
      });

      // Extract label + end from the just-updated sub so the eager DB write
      // matches what the webhook would eventually stamp.
      const first = updated.discounts?.[0];
      const coupon = first && typeof first !== "string" ? first.source?.coupon : null;
      const label =
        coupon && typeof coupon !== "string"
          ? (coupon.name ?? coupon.id)
          : (promoCoupon?.name ?? promoCoupon?.id ?? input.promotionCode);
      const endsAt =
        first && typeof first !== "string" && first.end ? new Date(first.end * 1000) : null;
      resolvedLabel = label;
      resolvedEndsAt = endsAt;

      await tx.agency.update({
        where: { id: input.id },
        data: {
          activeDiscountLabel: label,
          activeDiscountEndsAt: endsAt,
        },
      });

      audit.setAfter({
        stripeSubscriptionId: updated.id,
        promotionCodeId: promo.id,
        couponId: promoCoupon?.id ?? null,
        activeDiscountLabel: label,
        activeDiscountEndsAt: endsAt?.toISOString() ?? null,
      });
    },
  );

  return { couponLabel: resolvedLabel, endsAt: resolvedEndsAt };
}

export const removeAgencyDiscountInput = z.object({
  id: z.string().trim().min(1),
  note: z.string().trim().min(3).max(500),
});
export type RemoveAgencyDiscountInput = z.input<typeof removeAgencyDiscountInput>;

export async function removeAgencyDiscount(
  ctx: SystemAdminContext,
  rawInput: RemoveAgencyDiscountInput,
): Promise<void> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = removeAgencyDiscountInput.parse(rawInput);

  const agency = await prisma.agency.findUnique({
    where: { id: input.id },
    select: {
      id: true,
      name: true,
      stripeSubscriptionId: true,
      activeDiscountLabel: true,
      activeDiscountEndsAt: true,
    },
  });
  if (!agency) throw new NotFoundError(`Agency ${input.id} not found`);
  if (!agency.stripeSubscriptionId) {
    throw new ValidationError(
      `Agency ${input.id} has no active Stripe subscription — nothing to remove.`,
    );
  }
  if (agency.activeDiscountLabel === null) {
    throw new ValidationError(`Agency ${input.id} has no active discount to remove.`);
  }

  const stripe = requireStripeClient();

  await withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.SUBSCRIPTION_REMOVE_DISCOUNT,
      targetAgencyId: input.id,
      note: input.note,
    },
    async (tx, audit) => {
      audit.setBefore({
        stripeSubscriptionId: agency.stripeSubscriptionId,
        activeDiscountLabel: agency.activeDiscountLabel,
        activeDiscountEndsAt: agency.activeDiscountEndsAt?.toISOString() ?? null,
      });

      // Emptying the discounts array clears every sub-level discount. There
      // may be only one in our data model, but being explicit here means a
      // future multi-discount case doesn't leak a stale coupon.
      await stripe.subscriptions.update(agency.stripeSubscriptionId!, {
        discounts: [],
      });

      await tx.agency.update({
        where: { id: input.id },
        data: { activeDiscountLabel: null, activeDiscountEndsAt: null },
      });

      audit.setAfter({
        stripeSubscriptionId: agency.stripeSubscriptionId,
        activeDiscountLabel: null,
        activeDiscountEndsAt: null,
      });
    },
  );
}

export const recordInvoiceRefundIntentInput = z.object({
  /** Local Invoice.id (cuid), not the Stripe id. */
  invoiceId: z.string().trim().min(1),
  /** Required — the operator's reason, which becomes the audit note. */
  note: z.string().trim().min(3).max(500),
});
export type RecordInvoiceRefundIntentInput = z.input<typeof recordInvoiceRefundIntentInput>;

/**
 * Audit-only side effect. Repodcast doesn't process refunds itself; the
 * operator refunds in the Stripe dashboard. This helper records the intent
 * (who + why) so the audit log carries a matching row when the refund shows
 * up in Stripe.
 *
 * Returns the deep-link Stripe URL the caller can redirect to.
 */
export async function recordInvoiceRefundIntent(
  ctx: SystemAdminContext,
  rawInput: RecordInvoiceRefundIntentInput,
): Promise<{ stripeUrl: string }> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = recordInvoiceRefundIntentInput.parse(rawInput);

  const invoice = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    select: {
      id: true,
      stripeInvoiceId: true,
      amountCents: true,
      currency: true,
      status: true,
      agencyId: true,
    },
  });
  if (!invoice) throw new NotFoundError(`Invoice ${input.invoiceId} not found`);

  await withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.INVOICE_REFUND_REQUEST,
      targetAgencyId: invoice.agencyId,
      targetEntityType: "invoice",
      targetEntityId: invoice.id,
      note: input.note,
    },
    async (_tx, audit) => {
      audit.setBefore({
        invoiceId: invoice.id,
        stripeInvoiceId: invoice.stripeInvoiceId,
        amountCents: invoice.amountCents,
        currency: invoice.currency,
        status: invoice.status,
      });
      audit.setAfter(null);
    },
  );

  return {
    stripeUrl: `https://dashboard.stripe.com/invoices/${invoice.stripeInvoiceId}`,
  };
}

// ============================================================
// Phase 3.6.5 step 11 — hard-delete agency
// ============================================================
//
// Irreversible tenant-graph erasure. ROOT-only. Every step is designed so a
// partial failure lands in a recoverable state:
//
//   1. Pre-flight — verify the agency exists, that the operator typed the
//      correct name, and that no Stripe subscription is still live. An
//      active sub gets in the way because Stripe would keep billing a
//      ghost; the operator must force-cancel first.
//
//   2. R2 quarantine — copy every `audio/<id>/*` and `artwork/<id>/*` object
//      into `_quarantine/<id>/<isoTs>/*`, then delete the originals. Runs
//      OUTSIDE the DB transaction (long-running network calls). If this
//      throws, the DB row still exists and the tenant graph is intact.
//
//   3. DB delete — inside `withSystemAudit`, `prisma.agency.delete` triggers
//      the `onDelete: Cascade` chain across Member, Client, Show, Episode,
//      GeneratedOutput, Invoice, UsageLog, MemberInvite, MemberTransition,
//      OutputTransition, BillingReminderSent, OnboardingNudgeSent,
//      AgencyUsageSnapshot, AgencyLimitOverride. SystemAuditLog rows are
//      NOT cascaded (targetAgencyId is a plain String, no FK) — audit
//      history survives, matching the spec.

export const hardDeleteAgencyInput = z.object({
  id: z.string().trim().min(1),
  /** The operator must type the agency's name verbatim. */
  confirmName: z.string().trim().min(1),
  /** Required — long audit note explaining WHY. */
  note: z.string().trim().min(10).max(2_000),
});
export type HardDeleteAgencyInput = z.input<typeof hardDeleteAgencyInput>;

export type HardDeleteAgencyResult = {
  agencyId: string;
  agencyName: string;
  quarantine: {
    /** How many R2 objects were moved into the quarantine root. */
    copied: number;
    deleted: number;
    /** Full destination prefixes so a future restore knows where to look. */
    prefixes: string[];
  };
};

export async function hardDeleteAgency(
  ctx: SystemAdminContext,
  rawInput: HardDeleteAgencyInput,
): Promise<HardDeleteAgencyResult> {
  assertSystemRole(ctx, SYSTEM_ROOT_ONLY);

  const input = hardDeleteAgencyInput.parse(rawInput);

  // ------------------------------------------------------------
  // Pre-flight
  // ------------------------------------------------------------
  const agency = await prisma.agency.findUnique({
    where: { id: input.id },
    select: {
      id: true,
      name: true,
      plan: true,
      stripeSubscriptionId: true,
      stripeCustomerId: true,
      createdAt: true,
    },
  });
  if (!agency) throw new NotFoundError(`Agency ${input.id} not found`);
  if (input.confirmName.trim() !== agency.name.trim()) {
    throw new ValidationError(
      `Confirmation name doesn't match. Type the agency name exactly to proceed.`,
    );
  }
  if (agency.stripeSubscriptionId) {
    throw new ValidationError(
      `Agency ${input.id} still has an active Stripe subscription (${agency.stripeSubscriptionId}). ` +
        `Force-cancel the subscription first — Stripe would otherwise keep billing a ghost.`,
    );
  }

  // ------------------------------------------------------------
  // R2 quarantine (best-effort — skipped if R2 isn't configured)
  // ------------------------------------------------------------
  const quarantineTimestamp = new Date().toISOString();
  let quarantine: HardDeleteAgencyResult["quarantine"] = {
    copied: 0,
    deleted: 0,
    prefixes: [],
  };
  if (getR2Client() !== null) {
    const summary = await quarantineR2AgencyPrefixes(agency.id, quarantineTimestamp);
    quarantine = {
      copied: summary.copied,
      deleted: summary.deleted,
      prefixes: summary.quarantinePrefixes,
    };
  }
  // If R2 isn't configured, we're either in a fresh clone (no assets ever
  // stored) or the operator has misconfigured env. The audit row records
  // `copied: 0` so the delta is visible.

  // ------------------------------------------------------------
  // DB delete + audit
  // ------------------------------------------------------------
  await withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.AGENCY_HARD_DELETE,
      targetAgencyId: agency.id,
      targetEntityType: "agency",
      targetEntityId: agency.id,
      note: input.note,
    },
    async (tx, audit) => {
      audit.setBefore({
        id: agency.id,
        name: agency.name,
        plan: agency.plan,
        stripeCustomerId: agency.stripeCustomerId,
        createdAt: agency.createdAt.toISOString(),
        quarantine,
      });
      await tx.agency.delete({ where: { id: agency.id } });
      // After = null (row no longer exists). Prisma.JsonNull is written by
      // the wrapper — matches the delete pattern in other repos.
      audit.setAfter(null);
    },
  );

  return {
    agencyId: agency.id,
    agencyName: agency.name,
    quarantine,
  };
}
