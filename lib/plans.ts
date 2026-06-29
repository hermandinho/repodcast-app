import { Plan } from "@prisma/client";

/**
 * Per-plan limits + display metadata. Single source of truth for billing UI,
 * the `assertPlanCapacity` guard, and the Inngest cost-cap.
 *
 * Numbers chosen to align with the marketing tiers in PLAN.md:
 * STUDIO $99, AGENCY $249, NETWORK $499. Tune after launch as we learn
 * real-world generation costs.
 */
export type PlanLimits = {
  /** Max client shows. */
  shows: number;
  /** Max members per agency. */
  seats: number;
  /** Max episodes per month. */
  episodesPerMonth: number;
  /** Max generations (each output counts as one) per month. */
  generationsPerMonth: number;
  /** Hard monthly Claude spend cap in USD cents. */
  monthlyCostCapCents: number;
};

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  STUDIO: {
    shows: 3,
    seats: 2,
    episodesPerMonth: 20,
    generationsPerMonth: 140, // 20 episodes × 7 platforms
    monthlyCostCapCents: 2000, // $20
  },
  AGENCY: {
    shows: 10,
    seats: 6,
    episodesPerMonth: 60,
    generationsPerMonth: 420,
    monthlyCostCapCents: 6000, // $60
  },
  NETWORK: {
    shows: 25,
    seats: 999, // effectively unlimited
    episodesPerMonth: 200,
    generationsPerMonth: 1400,
    monthlyCostCapCents: 20000, // $200
  },
};

export type PlanDisplay = {
  name: string;
  priceUsd: number;
  tagline: string;
  highlights: string[];
};

export const PLAN_DISPLAY: Record<Plan, PlanDisplay> = {
  STUDIO: {
    name: "Studio",
    priceUsd: 99,
    tagline: "Solo + small shows",
    highlights: ["3 shows", "2 seats", "20 episodes / month"],
  },
  AGENCY: {
    name: "Agency",
    priceUsd: 249,
    tagline: "Multi-client production",
    highlights: ["10 shows", "6 seats", "60 episodes / month", "Batch processing"],
  },
  NETWORK: {
    name: "Network",
    priceUsd: 499,
    tagline: "Network-scale operations",
    highlights: [
      "25 shows",
      "Unlimited seats",
      "200 episodes / month",
      "Priority generation queue",
    ],
  },
};

export function planLimitsFor(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan];
}

export function planDisplayFor(plan: Plan): PlanDisplay {
  return PLAN_DISPLAY[plan];
}

/** Ordered list — used by the upgrade UI. */
export const PLAN_ORDER: Plan[] = [Plan.STUDIO, Plan.AGENCY, Plan.NETWORK];
