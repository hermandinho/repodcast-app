import "server-only";

import { BillingCadence, Plan } from "@prisma/client";

/**
 * Stripe Price ID lookup keyed by (Plan, BillingCadence). Each (plan ×
 * cadence) maps to a single Stripe Price that itself carries `currency_options`
 * for every code in `lib/currencies.ts` — so the Price ID is currency-agnostic;
 * Checkout picks the right currency at session-create time.
 *
 * Env naming: `NEXT_PUBLIC_STRIPE_<PLAN>_<CADENCE>_PRICE_ID`. The `NEXT_PUBLIC_`
 * prefix is historical — these IDs are not actually exposed to client bundles
 * (the lookup runs server-side), but keeping the prefix means existing Vercel
 * env-var setups don't need to be moved.
 *
 * `scripts/configure-stripe-plans.ts` provisions the Prices and prints the
 * IDs ready to paste.
 */

const ENV_KEY: Record<Plan, Record<BillingCadence, string>> = {
  SOLO: {
    MONTHLY: "NEXT_PUBLIC_STRIPE_SOLO_MONTHLY_PRICE_ID",
    ANNUAL: "NEXT_PUBLIC_STRIPE_SOLO_ANNUAL_PRICE_ID",
  },
  STUDIO: {
    MONTHLY: "NEXT_PUBLIC_STRIPE_STUDIO_MONTHLY_PRICE_ID",
    ANNUAL: "NEXT_PUBLIC_STRIPE_STUDIO_ANNUAL_PRICE_ID",
  },
  AGENCY: {
    MONTHLY: "NEXT_PUBLIC_STRIPE_AGENCY_MONTHLY_PRICE_ID",
    ANNUAL: "NEXT_PUBLIC_STRIPE_AGENCY_ANNUAL_PRICE_ID",
  },
  NETWORK: {
    MONTHLY: "NEXT_PUBLIC_STRIPE_NETWORK_MONTHLY_PRICE_ID",
    ANNUAL: "NEXT_PUBLIC_STRIPE_NETWORK_ANNUAL_PRICE_ID",
  },
};

export function priceIdFor(plan: Plan, cadence: BillingCadence = "MONTHLY"): string | null {
  return process.env[ENV_KEY[plan][cadence]] || null;
}

/**
 * Reverse lookup: given the Stripe Price ID a webhook payload references,
 * derive the matching (plan, cadence). Returns null when the ID doesn't
 * match any configured tier (e.g. a legacy or hand-created Price).
 */
export function planAndCadenceForPriceId(
  priceId: string,
): { plan: Plan; cadence: BillingCadence } | null {
  const plans: Plan[] = ["SOLO", "STUDIO", "AGENCY", "NETWORK"];
  const cadences: BillingCadence[] = ["MONTHLY", "ANNUAL"];
  for (const plan of plans) {
    for (const cadence of cadences) {
      if (process.env[ENV_KEY[plan][cadence]] === priceId) {
        return { plan, cadence };
      }
    }
  }
  return null;
}

/**
 * Legacy reverse lookup that drops the cadence. Kept until callers migrate
 * to `planAndCadenceForPriceId`. Returns the same Plan value as before.
 *
 * @deprecated Prefer `planAndCadenceForPriceId` so the agency row gets the
 * full (plan, cadence) update from the webhook.
 */
export function planForPriceId(priceId: string): Plan | null {
  return planAndCadenceForPriceId(priceId)?.plan ?? null;
}
