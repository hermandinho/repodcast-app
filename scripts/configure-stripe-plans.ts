/**
 * One-shot, idempotent Stripe Products + Prices bootstrap for Repodcast's
 * SaaS subscription plans. Pairs with `lib/plans.ts` (price source of truth)
 * and `lib/currencies.ts` (currency allowlist).
 *
 * Usage:  npm run stripe:plans
 *
 * For each Plan (SOLO / STUDIO / AGENCY / NETWORK) the script:
 *   1. Finds-or-creates a Stripe Product keyed by `metadata.repodcast_plan`.
 *   2. Finds-or-creates **two** recurring Prices keyed by the (plan, cadence)
 *      tuple — `metadata.repodcast_cadence = MONTHLY | ANNUAL`. Each Price's
 *      `currency_options` contains an entry for every code in
 *      `SUPPORTED_CURRENCIES` with the unit amount from
 *      `PLAN_PRICES_BY_CURRENCY`. A mismatch causes that specific Price to
 *      be archived + replaced (Stripe Prices are immutable on currency
 *      math).
 *   3. Prints the eight resulting Price IDs (4 plans × 2 cadences) ready
 *      to paste into `.env.local` as
 *      `NEXT_PUBLIC_STRIPE_<PLAN>_<CADENCE>_PRICE_ID`.
 *
 * Re-running is safe: an existing matching Price is re-used, only mismatches
 * trigger a replace. The script never deletes Products; archived Prices stay
 * in Stripe for historical subscriptions.
 *
 * NOTE — the $1 trial activation fee (Solo + Studio) is NOT provisioned
 * here. It's created on the fly by the `checkout.session.completed`
 * webhook via `stripe.invoiceItems.create` (a raw amount + description,
 * no Price ID). See `app/api/webhooks/stripe/route.ts#handleCheckoutSessionCompleted`
 * for why: Stripe defers one-time subscription line items to `trial_end`
 * when `trial_period_days` is set, so the "$1 today" needed to land as a
 * separate immediate invoice instead.
 *
 * Requires `STRIPE_SECRET_KEY` in `.env.local`.
 */

import { BillingCadence, Plan } from "@prisma/client";
import Stripe from "stripe";
import {
  CURRENCY_META,
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from "../lib/currencies";
import { PLAN_DISPLAY, PLAN_PRICES_BY_CURRENCY, PLAN_ORDER } from "../lib/plans";
import { loadEnvLocal } from "./load-env-local";

loadEnvLocal();

const STRIPE_API_VERSION = "2026-06-24.dahlia" as const;
const PRODUCT_KEY = "repodcast_plan";
const PRICE_ROLE_KEY = "repodcast_role";
const PRICE_ROLE_VALUE = "primary";
const PRICE_CADENCE_KEY = "repodcast_cadence";

const CADENCES: readonly BillingCadence[] = ["MONTHLY", "ANNUAL"];

type SyncResult = {
  plan: Plan;
  cadence: BillingCadence;
  productId: string;
  priceId: string;
  /** True when this run had to create-or-replace the Price (vs. reuse it). */
  changed: boolean;
};

type CreateCurrencyOptionsMap = {
  [key: string]: Stripe.PriceCreateParams.CurrencyOptions;
};

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error("Missing STRIPE_SECRET_KEY. Set it in .env.local first.");
    process.exit(1);
  }
  const stripe = new Stripe(key, { apiVersion: STRIPE_API_VERSION, typescript: true });

  console.log("Syncing Stripe Products + Prices for Repodcast plans...\n");

  const results: SyncResult[] = [];
  for (const plan of PLAN_ORDER) {
    // One Product per plan; two Prices per product (monthly + annual).
    const display = PLAN_DISPLAY[plan];
    const product = await findOrCreateProduct(stripe, plan, display.name, display.tagline);
    for (const cadence of CADENCES) {
      const result = await syncPlanPrice(stripe, plan, cadence, product);
      results.push(result);
      const marker = result.changed ? "✓ updated" : "= unchanged";
      console.log(
        `  ${marker.padEnd(13)} ${plan.padEnd(8)} ${cadence.padEnd(8)} → ${result.priceId}`,
      );
    }
  }

  console.log("\nPaste these into .env.local (NEXT_PUBLIC_STRIPE_<PLAN>_<CADENCE>_PRICE_ID):\n");
  for (const r of results) {
    console.log(`NEXT_PUBLIC_STRIPE_${r.plan}_${r.cadence}_PRICE_ID="${r.priceId}"`);
  }
  console.log("");
}

async function syncPlanPrice(
  stripe: Stripe,
  plan: Plan,
  cadence: BillingCadence,
  product: Stripe.Product,
): Promise<SyncResult> {
  const prices =
    cadence === "ANNUAL"
      ? PLAN_PRICES_BY_CURRENCY[plan].annual
      : PLAN_PRICES_BY_CURRENCY[plan].monthly;

  const desired = buildPriceCreatePayload(plan, cadence, prices);

  const existing = await findCurrentPrice(stripe, product.id, plan, cadence);
  if (existing && pricesEquivalent(existing, desired, cadence)) {
    return { plan, cadence, productId: product.id, priceId: existing.id, changed: false };
  }

  const created = await stripe.prices.create({ ...desired, product: product.id });
  if (existing) {
    await stripe.prices.update(existing.id, { active: false });
  }
  return { plan, cadence, productId: product.id, priceId: created.id, changed: true };
}

async function findOrCreateProduct(
  stripe: Stripe,
  plan: Plan,
  name: string,
  description: string,
): Promise<Stripe.Product> {
  // `search` is gated to API keys with search enabled (default-on for newer
  // accounts). Falls back to a list filter if search isn't available.
  try {
    const search = await stripe.products.search({
      query: `active:"true" AND metadata["${PRODUCT_KEY}"]:"${plan}"`,
      limit: 1,
    });
    if (search.data.length > 0) {
      const existing = search.data[0];
      if (existing.name !== name || existing.description !== description) {
        return stripe.products.update(existing.id, { name, description });
      }
      return existing;
    }
  } catch (err) {
    // Older API keys without search privileges fall through to the list path.
    if (!(err instanceof Error) || !/search/i.test(err.message)) throw err;
  }

  const all = await stripe.products.list({ active: true, limit: 100 });
  const existing = all.data.find((p) => p.metadata?.[PRODUCT_KEY] === plan);
  if (existing) {
    if (existing.name !== name || existing.description !== description) {
      return stripe.products.update(existing.id, { name, description });
    }
    return existing;
  }

  return stripe.products.create({
    name,
    description,
    metadata: { [PRODUCT_KEY]: plan },
  });
}

async function findCurrentPrice(
  stripe: Stripe,
  productId: string,
  plan: Plan,
  cadence: BillingCadence,
): Promise<Stripe.Price | null> {
  const list = await stripe.prices.list({
    product: productId,
    active: true,
    limit: 100,
    expand: ["data.currency_options"],
  });
  return (
    list.data.find(
      (p) =>
        p.metadata?.[PRODUCT_KEY] === plan &&
        p.metadata?.[PRICE_ROLE_KEY] === PRICE_ROLE_VALUE &&
        p.metadata?.[PRICE_CADENCE_KEY] === cadence,
    ) ?? null
  );
}

function buildPriceCreatePayload(
  plan: Plan,
  cadence: BillingCadence,
  prices: Record<SupportedCurrency, number>,
): Stripe.PriceCreateParams {
  const baseCurrency: SupportedCurrency = DEFAULT_CURRENCY;
  const currencyOptions: CreateCurrencyOptionsMap = {};
  for (const c of SUPPORTED_CURRENCIES) {
    if (c === baseCurrency) continue;
    currencyOptions[CURRENCY_META[c].stripeCode] = {
      unit_amount: prices[c] * 100,
    };
  }
  const interval: Stripe.PriceCreateParams.Recurring.Interval =
    cadence === "ANNUAL" ? "year" : "month";
  return {
    currency: CURRENCY_META[baseCurrency].stripeCode,
    unit_amount: prices[baseCurrency] * 100,
    recurring: { interval },
    nickname: `Repodcast ${plan} ${cadence} (multi-currency)`,
    metadata: {
      [PRODUCT_KEY]: plan,
      [PRICE_ROLE_KEY]: PRICE_ROLE_VALUE,
      [PRICE_CADENCE_KEY]: cadence,
    },
    currency_options: currencyOptions,
  };
}

/**
 * Compare an existing Price against the desired payload. Returns true when
 * every (currency, unit_amount) pair matches — including the base currency.
 * Recurring interval + metadata role are checked too. A mismatch triggers a
 * replace (Stripe Prices are immutable for currency math).
 */
function pricesEquivalent(
  existing: Stripe.Price,
  desired: Stripe.PriceCreateParams,
  cadence: BillingCadence,
): boolean {
  if (existing.currency !== desired.currency) return false;
  if (existing.unit_amount !== desired.unit_amount) return false;
  if (existing.recurring?.interval !== (cadence === "ANNUAL" ? "year" : "month")) return false;
  if (existing.type !== "recurring") return false;

  const desiredOpts = (desired.currency_options ?? {}) as CreateCurrencyOptionsMap;
  const existingOpts = (existing.currency_options ?? {}) as Record<
    string,
    Stripe.Price.CurrencyOptions
  >;

  const desiredCurrencies = Object.keys(desiredOpts);
  const existingCurrencies = Object.keys(existingOpts);
  if (desiredCurrencies.length !== existingCurrencies.length) return false;
  for (const c of desiredCurrencies) {
    const d = desiredOpts[c]?.unit_amount;
    const e = existingOpts[c]?.unit_amount;
    if (d !== e) return false;
  }
  return true;
}

main().catch((err) => {
  console.error("\nFailed to configure Stripe plans:", err);
  process.exit(1);
});
