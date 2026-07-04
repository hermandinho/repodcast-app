import { BillingCadence, Plan } from "@/lib/enums";
import { DEFAULT_CURRENCY, type SupportedCurrency } from "@/lib/currencies";

/**
 * Per-plan limits + display metadata. Single source of truth for billing UI,
 * the `assertPlanCapacity` guard, and the Inngest cost-cap.
 *
 * Marketing tiers (baseline USD monthly): SOLO $29, STUDIO $89, NETWORK $299.
 * Non-USD numbers follow launch ratios (EUR = USD, GBP ≈ 0.85×, CAD ≈ 1.35×,
 * AUD ≈ 1.50× USD). Annual = monthly × 10 ("two months free").
 * `scripts/configure-stripe-plans.ts` writes the same numbers into each
 * plan's Stripe Price `currency_options`, so the dashboard is the source
 * of truth once provisioned.
 *
 * `monthlyCostCapCents` is set at 30% of the plan's USD monthly price —
 * a ceiling ~2.25× the observed blended COGS (~$0.20/episode) at the
 * plan's episode allowance. Caps exist to guard against runaway fan-out,
 * not to gate normal usage; 30% forces a clear investigation trigger
 * when we breach it. See MarketingStrategy.md §0.
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
  SOLO: {
    shows: 1,
    seats: 1,
    episodesPerMonth: 20,
    generationsPerMonth: 140, // 20 episodes × 7 platforms
    monthlyCostCapCents: 900, // $9 (30% of $29)
  },
  STUDIO: {
    shows: 5,
    seats: 3,
    episodesPerMonth: 60,
    generationsPerMonth: 420, // 60 × 7
    monthlyCostCapCents: 2700, // $27 (30% of $89)
  },
  NETWORK: {
    shows: 25,
    seats: 999, // effectively unlimited
    episodesPerMonth: 250,
    generationsPerMonth: 1750, // 250 × 7
    monthlyCostCapCents: 9000, // $90 (30% of $299)
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

const SOLO_MONTHLY: PlanPrices = { USD: 29, EUR: 29, GBP: 25, CAD: 39, AUD: 45 };
const STUDIO_MONTHLY: PlanPrices = { USD: 89, EUR: 89, GBP: 75, CAD: 119, AUD: 135 };
const NETWORK_MONTHLY: PlanPrices = { USD: 299, EUR: 299, GBP: 249, CAD: 399, AUD: 449 };

/**
 * Per-plan, per-currency, per-cadence prices in whole currency units. The
 * Stripe Price for each (plan × cadence) carries these inside its
 * `currency_options`; `scripts/configure-stripe-plans.ts` syncs from here
 * to Stripe (idempotent). PLAN_DISPLAY reads from this map so the UI never
 * drifts from what's actually billed.
 */
export const PLAN_PRICES_BY_CURRENCY: Record<Plan, PlanPricesByCadence> = {
  SOLO: { monthly: SOLO_MONTHLY, annual: annualOf(SOLO_MONTHLY) },
  STUDIO: { monthly: STUDIO_MONTHLY, annual: annualOf(STUDIO_MONTHLY) },
  NETWORK: { monthly: NETWORK_MONTHLY, annual: annualOf(NETWORK_MONTHLY) },
};

export const PLAN_DISPLAY: Record<Plan, PlanDisplay> = {
  SOLO: {
    name: "Solo",
    prices: PLAN_PRICES_BY_CURRENCY.SOLO,
    tagline: "One host, one show, your voice",
    highlights: ["1 show", "1 seat", "20 episodes / month"],
  },
  STUDIO: {
    name: "Studio",
    prices: PLAN_PRICES_BY_CURRENCY.STUDIO,
    tagline: "Small teams, multiple shows",
    highlights: ["5 shows", "3 seats", "60 episodes / month"],
  },
  NETWORK: {
    name: "Network",
    prices: PLAN_PRICES_BY_CURRENCY.NETWORK,
    tagline: "Agencies with clients",
    // Kept intentionally to four bullets so all three plan cards align to
    // roughly the same height in the picker grid; per-line commas below
    // pack the six real feature deltas into four rows.
    highlights: [
      "25 shows · unlimited seats",
      "250 episodes / month",
      "Client portals + white-label",
      "Batch processing · priority queue",
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
export const PLAN_ORDER: Plan[] = [Plan.SOLO, Plan.STUDIO, Plan.NETWORK];

/**
 * Free-trial length in days. Passed to Stripe as `trial_period_days` on the
 * onboarding Checkout Session; also drives the T-3 reminder cron and the
 * in-app "X days left" banner. See MarketingStrategy.md §1.
 */
export const TRIAL_DAYS = 7;

/**
 * One-time activation fee charged at Checkout day 0, in USD cents. Applied
 * uniformly across every currency (£1, €1, C$1, A$1) via a Stripe Price
 * with `currency_options`. Non-refundable — framed as an activation fee,
 * not a prorated first-day charge. See MarketingStrategy.md §1.
 */
export const TRIAL_ACTIVATION_FEE_CENTS = 100;
