import "server-only";

import type { Plan } from "@prisma/client";
import { ForbiddenError } from "@/server/auth/errors";
import { prisma } from "@/server/db/client";
import { planLimitsFor } from "@/lib/plans";
import {
  getEffectiveLimitOverride,
  LIMITED_TO_LIMIT_OVERRIDE_RESOURCE,
} from "@/server/db/system/config";

export type LimitedResource = "shows" | "members" | "episodes" | "generations";

type PlanCapacityResult = {
  used: number;
  limit: number;
};

function monthStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * Current usage of `resource` for this agency in the current billing window.
 * Surfaces (used, limit) so the UI can render meters before the user attempts
 * a write.
 *
 * `limit` respects an `AgencyLimitOverride` if a live (unexpired) row exists
 * for this (agency, resource). Overrides are absolute — the override value
 * replaces the plan default outright rather than adding to it, so operators
 * can also use them to CAP an abusing agency below its plan tier. See
 * `server/db/system/config.ts#getEffectiveLimitOverride`.
 */
export async function planCapacity(
  agencyId: string,
  plan: Plan,
  resource: LimitedResource,
): Promise<PlanCapacityResult> {
  const limits = planLimitsFor(plan);
  const [override, used] = await Promise.all([
    getEffectiveLimitOverride(agencyId, LIMITED_TO_LIMIT_OVERRIDE_RESOURCE[resource]),
    countUsed(agencyId, resource),
  ]);
  const planLimit = planDefaultFor(limits, resource);
  return { used, limit: override ?? planLimit };
}

function planDefaultFor(
  limits: ReturnType<typeof planLimitsFor>,
  resource: LimitedResource,
): number {
  switch (resource) {
    case "shows":
      return limits.shows;
    case "members":
      return limits.seats;
    case "episodes":
      return limits.episodesPerMonth;
    case "generations":
      return limits.generationsPerMonth;
  }
}

async function countUsed(agencyId: string, resource: LimitedResource): Promise<number> {
  switch (resource) {
    case "shows":
      return prisma.show.count({ where: { client: { agencyId } } });
    case "members":
      return prisma.member.count({ where: { agencyId } });
    case "episodes":
      return prisma.episode.count({
        where: {
          show: { client: { agencyId } },
          createdAt: { gte: monthStart() },
        },
      });
    case "generations":
      return prisma.generatedOutput.count({
        where: {
          episode: { show: { client: { agencyId } } },
          createdAt: { gte: monthStart() },
        },
      });
  }
}

/**
 * Throw `ForbiddenError` when an agency is already at-or-over its `resource`
 * limit. Server actions call this *before* writes; the Inngest orchestrator
 * calls this before fanning out generations.
 */
export async function assertPlanCapacity(
  agencyId: string,
  plan: Plan,
  resource: LimitedResource,
): Promise<void> {
  const { used, limit } = await planCapacity(agencyId, plan, resource);
  if (used >= limit) {
    throw new ForbiddenError(
      `Plan ${plan} caps ${resource} at ${limit} (currently ${used}). Upgrade to add more.`,
    );
  }
}

/**
 * Does this agency currently have valid dashboard access? True when it has
 * an active Stripe subscription OR a live ROOT-granted comp window
 * (`compAccessExpiresAt` in the future). This is the shared predicate used
 * by every "block if unpaid" gate — the onboarding router, the dashboard
 * layout, and `assertActiveSubscription`.
 *
 * A single field pair (`stripeSubscriptionId`, `compAccessExpiresAt`) is
 * enough — checking `Date.now()` inline avoids a stale-clock race (a
 * long-lived server component reading a cached value at the top of the
 * request lifecycle) and needs no cron to clean up expired comps.
 */
export function hasActiveAccess(agency: {
  stripeSubscriptionId: string | null;
  compAccessExpiresAt: Date | null;
}): boolean {
  if (agency.stripeSubscriptionId) return true;
  if (agency.compAccessExpiresAt && agency.compAccessExpiresAt.getTime() > Date.now()) return true;
  return false;
}

/**
 * Read the current agency's *effective* plan in one query. Prefers
 * `planOverride` (set by ROOT via `grantAgencyPlanOverride`) when present —
 * so comp accounts and support-escalation grants take effect without
 * touching Stripe or the customer's paid tier.
 */
export async function getAgencyPlan(agencyId: string): Promise<Plan> {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { plan: true, planOverride: true },
  });
  if (!agency) throw new ForbiddenError("Agency not found");
  return agency.planOverride ?? agency.plan;
}

/**
 * Plan tier order. Used by `assertMinPlan` to decide whether the caller's
 * plan clears a per-feature minimum. Higher rank = more privileged tier.
 */
const PLAN_RANK: Record<Plan, number> = {
  SOLO: 0,
  STUDIO: 1,
  AGENCY: 2,
  NETWORK: 3,
};

/**
 * Throw `ForbiddenError` if the caller's plan is below `minimum`. Used by
 * plan-gated features (white-label branding, client portals, batch
 * generation, priority queue) that live above the capacity meters.
 *
 * The message names the required plan so callers can surface an upgrade
 * CTA without a second string in every action.
 */
export function assertMinPlan(plan: Plan, minimum: Plan): void {
  if (PLAN_RANK[plan] < PLAN_RANK[minimum]) {
    throw new ForbiddenError(
      `Plan ${plan} doesn't include this feature. Upgrade to ${minimum} or higher.`,
    );
  }
}

/**
 * Shape used by the `<PlanLimitBanner>` UI — bundles plan + resource so the
 * banner can render its own copy without a second DB round-trip. Returns
 * null in sample-data mode (callers pass null through to the banner, which
 * renders nothing).
 */
export type PlanCapacityForUI = {
  used: number;
  limit: number;
  plan: Plan;
  resource: LimitedResource;
};

export async function loadCapacityForUI(
  agencyId: string,
  resource: LimitedResource,
): Promise<PlanCapacityForUI> {
  const plan = await getAgencyPlan(agencyId);
  const { used, limit } = await planCapacity(agencyId, plan, resource);
  return { used, limit, plan, resource };
}
