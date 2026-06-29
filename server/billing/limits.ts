import "server-only";

import type { Plan } from "@prisma/client";
import { ForbiddenError } from "@/server/auth/errors";
import { prisma } from "@/server/db/client";
import { planLimitsFor } from "@/lib/plans";

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
 */
export async function planCapacity(
  agencyId: string,
  plan: Plan,
  resource: LimitedResource,
): Promise<PlanCapacityResult> {
  const limits = planLimitsFor(plan);

  switch (resource) {
    case "shows": {
      // Shows are the metered resource — clients are unlimited (a single
      // client can own many shows in the new hierarchy).
      const used = await prisma.show.count({
        where: { client: { agencyId } },
      });
      return { used, limit: limits.shows };
    }
    case "members": {
      const used = await prisma.member.count({ where: { agencyId } });
      return { used, limit: limits.seats };
    }
    case "episodes": {
      const used = await prisma.episode.count({
        where: {
          show: { client: { agencyId } },
          createdAt: { gte: monthStart() },
        },
      });
      return { used, limit: limits.episodesPerMonth };
    }
    case "generations": {
      const used = await prisma.generatedOutput.count({
        where: {
          episode: { show: { client: { agencyId } } },
          createdAt: { gte: monthStart() },
        },
      });
      return { used, limit: limits.generationsPerMonth };
    }
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

/** Read the current agency's plan in one query — used by route-level guards. */
export async function getAgencyPlan(agencyId: string): Promise<Plan> {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { plan: true },
  });
  if (!agency) throw new ForbiddenError("Agency not found");
  return agency.plan;
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
