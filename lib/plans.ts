import { BillingCadence, Plan } from "@/lib/enums";
import { DEFAULT_CURRENCY, type SupportedCurrency } from "@/lib/currencies";

/**
 * Per-plan limits + display metadata. Single source of truth for billing UI,
 * the `assertPlanCapacity` guard, and the Inngest cost-cap.
 *
 * Numbers chosen to align with the marketing tiers in PLAN.md:
 * STUDIO $99, AGENCY $249, NETWORK $499 (baseline USD monthly). Non-USD
 * numbers are sensible launch placeholders. Annual = monthly × 10 ("two
 * months free"). `scripts/configure-stripe-plans.ts` writes the same
 * numbers into each plan's Stripe Price `currency_options`, so the
 * dashboard is the source of truth once provisioned. Tune after launch as
 * we learn real-world generation costs.
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

export type PlanPrices = Record<SupportedCurrency, number>;

export type PlanPricesByCadence = {
  /** Whole currency units per month. */
  monthly: PlanPrices;
  /**
   * Whole currency units per year. By construction `annual = monthly × 10`
   * ("two months free"), so the discount math reads as "Save 2 months" on
   * the pricing page. If you flip to a percentage discount instead, also
   * flip the copy on `/pricing`.
   */
  annual: PlanPrices;
};

export type PlanDisplay = {
  name: string;
  prices: PlanPricesByCadence;
  tagline: string;
  highlights: string[];
};

function annualOf(monthly: PlanPrices): PlanPrices {
  return {
    USD: monthly.USD * 10,
    EUR: monthly.EUR * 10,
    GBP: monthly.GBP * 10,
    CAD: monthly.CAD * 10,
    AUD: monthly.AUD * 10,
  };
}

const STUDIO_MONTHLY: PlanPrices = { USD: 99, EUR: 99, GBP: 79, CAD: 139, AUD: 149 };
const AGENCY_MONTHLY: PlanPrices = { USD: 249, EUR: 249, GBP: 199, CAD: 349, AUD: 379 };
const NETWORK_MONTHLY: PlanPrices = { USD: 499, EUR: 499, GBP: 399, CAD: 699, AUD: 749 };

/**
 * Per-plan, per-currency, per-cadence prices in whole currency units. The
 * Stripe Price for each (plan × cadence) carries these inside its
 * `currency_options`; `scripts/configure-stripe-plans.ts` syncs from here
 * to Stripe (idempotent). PLAN_DISPLAY reads from this map so the UI never
 * drifts from what's actually billed.
 */
export const PLAN_PRICES_BY_CURRENCY: Record<Plan, PlanPricesByCadence> = {
  STUDIO: { monthly: STUDIO_MONTHLY, annual: annualOf(STUDIO_MONTHLY) },
  AGENCY: { monthly: AGENCY_MONTHLY, annual: annualOf(AGENCY_MONTHLY) },
  NETWORK: { monthly: NETWORK_MONTHLY, annual: annualOf(NETWORK_MONTHLY) },
};

export const PLAN_DISPLAY: Record<Plan, PlanDisplay> = {
  STUDIO: {
    name: "Studio",
    prices: PLAN_PRICES_BY_CURRENCY.STUDIO,
    tagline: "Solo + small shows",
    highlights: ["3 shows", "2 seats", "20 episodes / month"],
  },
  AGENCY: {
    name: "Agency",
    prices: PLAN_PRICES_BY_CURRENCY.AGENCY,
    tagline: "Multi-client production",
    highlights: ["10 shows", "6 seats", "60 episodes / month", "Batch processing"],
  },
  NETWORK: {
    name: "Network",
    prices: PLAN_PRICES_BY_CURRENCY.NETWORK,
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

/**
 * Per-plan price in a given currency + cadence, falling back to USD if the
 * currency isn't priced (defensive — should never happen with
 * `SupportedCurrency`, but keeps callers safe if the prices map is ever
 * loosened to a partial). Cadence defaults to `MONTHLY` so call-sites that
 * predate annual pricing keep working unchanged.
 */
export function priceFor(
  plan: Plan,
  currency: SupportedCurrency = DEFAULT_CURRENCY,
  cadence: BillingCadence = "MONTHLY",
): number {
  const prices =
    cadence === "ANNUAL"
      ? PLAN_PRICES_BY_CURRENCY[plan].annual
      : PLAN_PRICES_BY_CURRENCY[plan].monthly;
  return prices[currency] ?? prices[DEFAULT_CURRENCY];
}

/**
 * Effective monthly price for the (plan, cadence) pair — annual amortized
 * by 12. Used by the pricing page to show "$X/mo billed annually". Returns
 * whole currency units (the same scale as `priceFor`); fractional cents
 * stay inside since this is a display helper only.
 */
export function effectiveMonthlyPrice(
  plan: Plan,
  currency: SupportedCurrency = DEFAULT_CURRENCY,
  cadence: BillingCadence = "MONTHLY",
): number {
  if (cadence === "ANNUAL") {
    return priceFor(plan, currency, "ANNUAL") / 12;
  }
  return priceFor(plan, currency, "MONTHLY");
}

/** Ordered list — used by the upgrade UI. */
export const PLAN_ORDER: Plan[] = [Plan.STUDIO, Plan.AGENCY, Plan.NETWORK];
