import { BillingCadence, Plan } from "@/lib/enums";
import { DEFAULT_CURRENCY, type SupportedCurrency } from "@/lib/currencies";

/**
 * Per-plan limits + display metadata. Single source of truth for billing UI,
 * the `assertPlanCapacity` guard, and the Inngest cost-cap.
 *
 * Marketing tiers (baseline USD monthly): SOLO $29, STUDIO $89, AGENCY $179,
 * NETWORK $299. The AGENCY tier fills the 5→25-show gap that used to strand
 * 8–15-show buyers between Studio and Network. Non-USD numbers follow launch
 * ratios (EUR = USD, GBP ≈ 0.85×, CAD ≈ 1.35×, AUD ≈ 1.50× USD). Annual =
 * monthly × 10 ("two months free"). `scripts/configure-stripe-plans.ts`
 * writes the same numbers into each plan's Stripe Price `currency_options`,
 * so the dashboard is the source of truth once provisioned.
 *
 * `monthlyCostCapCents` is set at 30% of the plan's USD monthly price —
 * a ceiling ~2.25× the observed blended COGS (~$0.20/episode) at the
 * plan's episode allowance. Caps exist to guard against runaway fan-out,
 * not to gate normal usage; 30% forces a clear investigation trigger
 * when we breach it. Never surfaced to buyers — the cost cap is an
 * internal guardrail, not a plan feature. See MarketingStrategy.md §0.
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

  // ---- PricingV2 additions (see PricingV2.md §3) ----

  /**
   * Cap on the number of vertical clips generated per episode. Enforced
   * by `requestClipsAction` when passing `maxClips` into the highlight-
   * selection prompt.
   */
  clipsPerEpisode: number;

  /**
   * Monthly cap on clip regenerations. The first render for each clip
   * on an episode is free (bundled with `Generate clips`); every
   * subsequent re-run — retry, trim + re-render, `Regenerate all` —
   * increments this counter and is blocked when the cap is hit.
   *
   * `Infinity` means soft-unlimited (the plan's `monthlyCostCapCents`
   * is the real ceiling).
   */
  clipRegenerationsPerMonth: number;

  /**
   * Monthly cap on artwork regenerations. First `Generate artwork`
   * call on an episode is free; regenerating (calling again when
   * artwork already exists) is charged.
   */
  artworkRegenerationsPerMonth: number;

  /**
   * Monthly cap on audiogram regenerations. First `Generate audiogram`
   * per output is free; regenerating that same output's audiogram
   * counts.
   */
  audiogramRegenerationsPerMonth: number;
};

/**
 * Sentinel for the "unlimited" tier — internally we soft-cap on the
 * plan's cost cap, but the visible cap is unbounded. Using
 * `Number.MAX_SAFE_INTEGER` (not `Infinity`) so Prisma count comparisons
 * and JSON serialization behave.
 */
export const REGEN_UNLIMITED = Number.MAX_SAFE_INTEGER;

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  SOLO: {
    shows: 1,
    seats: 1,
    episodesPerMonth: 20,
    generationsPerMonth: 140, // 20 episodes × 7 platforms
    monthlyCostCapCents: 900, // $9 (30% of $29)
    // PricingV2 §3
    clipsPerEpisode: 3,
    clipRegenerationsPerMonth: 40,
    artworkRegenerationsPerMonth: 10,
    audiogramRegenerationsPerMonth: 40,
  },
  STUDIO: {
    shows: 5,
    seats: 3,
    episodesPerMonth: 60,
    generationsPerMonth: 420, // 60 × 7
    monthlyCostCapCents: 2700, // $27 (30% of $89)
    clipsPerEpisode: 5,
    clipRegenerationsPerMonth: 200,
    artworkRegenerationsPerMonth: 40,
    audiogramRegenerationsPerMonth: 200,
  },
  AGENCY: {
    shows: 12,
    seats: 6,
    episodesPerMonth: 150,
    generationsPerMonth: 1050, // 150 × 7
    monthlyCostCapCents: 5400, // $54 (30% of $179)
    clipsPerEpisode: 5,
    clipRegenerationsPerMonth: 500,
    artworkRegenerationsPerMonth: 100,
    audiogramRegenerationsPerMonth: 500,
  },
  NETWORK: {
    shows: 25,
    seats: 999, // effectively unlimited
    episodesPerMonth: 300,
    generationsPerMonth: 2100, // 300 × 7
    monthlyCostCapCents: 9000, // $90 (30% of $299)
    clipsPerEpisode: 10,
    clipRegenerationsPerMonth: REGEN_UNLIMITED,
    artworkRegenerationsPerMonth: REGEN_UNLIMITED,
    audiogramRegenerationsPerMonth: REGEN_UNLIMITED,
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
const AGENCY_MONTHLY: PlanPrices = { USD: 179, EUR: 179, GBP: 149, CAD: 239, AUD: 269 };
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
  AGENCY: { monthly: AGENCY_MONTHLY, annual: annualOf(AGENCY_MONTHLY) },
  NETWORK: { monthly: NETWORK_MONTHLY, annual: annualOf(NETWORK_MONTHLY) },
};

export const PLAN_DISPLAY: Record<Plan, PlanDisplay> = {
  SOLO: {
    name: "Solo",
    prices: PLAN_PRICES_BY_CURRENCY.SOLO,
    tagline: "Just you — one show, one voice",
    highlights: [
      "7 posts + 3 clips + artwork + audiograms per episode",
      "20 episodes / month",
      "1 show · 1 seat",
    ],
  },
  STUDIO: {
    name: "Studio",
    prices: PLAN_PRICES_BY_CURRENCY.STUDIO,
    tagline: "Small teams, multiple shows",
    highlights: [
      "7 posts + 5 clips + artwork + audiograms per episode",
      "60 episodes / month",
      "5 shows · 3 seats",
      "Batch generation",
    ],
  },
  AGENCY: {
    name: "Agency",
    prices: PLAN_PRICES_BY_CURRENCY.AGENCY,
    tagline: "Full-service studios with a client roster",
    highlights: [
      "7 posts + 5 clips + artwork + audiograms per episode",
      "150 episodes / month",
      "12 shows · 6 seats",
      "Branded client portal",
    ],
  },
  NETWORK: {
    name: "Network",
    prices: PLAN_PRICES_BY_CURRENCY.NETWORK,
    tagline: "The full agency stack",
    highlights: [
      "7 posts + 10 clips + artwork + audiograms per episode",
      "300 episodes / month",
      "25 shows · unlimited seats",
      "White-label + custom domain + priority queue",
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

/** Ordered list — used by the upgrade UI. Matches PLAN_RANK in
 *  `server/billing/limits.ts`. */
export const PLAN_ORDER: Plan[] = [Plan.SOLO, Plan.STUDIO, Plan.AGENCY, Plan.NETWORK];

/**
 * Plans where the operator gets the $1/7-day trial on Checkout. Solo and
 * Studio only — Agency and Network go straight to full-price subscription
 * (higher-intent buyers, and caps trial abuse at the top of the ladder).
 * The trial-eligibility gate in `checkoutFromOnboardingAction` reads this.
 */
export const TRIAL_ELIGIBLE_PLANS: readonly Plan[] = [Plan.SOLO, Plan.STUDIO];

export function isTrialEligiblePlan(plan: Plan): boolean {
  return TRIAL_ELIGIBLE_PLANS.includes(plan);
}

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
