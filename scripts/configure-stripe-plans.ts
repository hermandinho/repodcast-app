/**
 * One-shot, idempotent Stripe Products + Prices bootstrap for Repodcast's
 * SaaS subscription plans. Pairs with `lib/plans.ts` (price source of truth)
 * and `lib/currencies.ts` (currency allowlist).
 *
 * Usage:  npm run stripe:plans
 *
 * For each Plan (STUDIO / AGENCY / NETWORK) the script:
 *   1. Finds-or-creates a Stripe Product keyed by `metadata.repodcast_plan`.
 *   2. Finds-or-creates a recurring monthly Price keyed by
 *      `metadata.repodcast_plan` + `metadata.repodcast_role=primary`.
 *   3. Ensures the Price's `currency_options` contains an entry for every
 *      currency in `SUPPORTED_CURRENCIES`, with the unit amount from
 *      `PLAN_PRICES_BY_CURRENCY`. A mismatch causes the Price to be
 *      archived + replaced (Stripe Prices are immutable on currency math).
 *   4. Prints the three resulting Price IDs ready to paste into
 *      `.env.local` as `NEXT_PUBLIC_STRIPE_*_PRICE_ID`.
 *
 * Re-running is safe: an existing matching Price is re-used, only mismatches
 * trigger a replace. The script never deletes Products; archived Prices stay
 * in Stripe for historical subscriptions.
 *
 * Requires `STRIPE_SECRET_KEY` in `.env.local`.
 */

import { Plan } from "@prisma/client";
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

type SyncResult = {
  plan: Plan;
  productId: string;
  priceId: string;
  /** True when this run had to create-or-replace the Price (vs. reuse it). */
  changed: boolean;
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
    const result = await syncPlan(stripe, plan);
    results.push(result);
    const marker = result.changed ? "✓ updated" : "= unchanged";
    console.log(`  ${marker.padEnd(13)} ${plan.padEnd(8)} → ${result.priceId}`);
  }

  console.log("\nPaste these into .env.local (NEXT_PUBLIC_STRIPE_*_PRICE_ID):\n");
  for (const r of results) {
    console.log(`NEXT_PUBLIC_STRIPE_${r.plan}_PRICE_ID="${r.priceId}"`);
  }
  console.log("");
}

async function syncPlan(stripe: Stripe, plan: Plan): Promise<SyncResult> {
  const display = PLAN_DISPLAY[plan];
  const prices = PLAN_PRICES_BY_CURRENCY[plan];

  // ---- 1. Product (find by metadata key, else create) ----
  const product = await findOrCreateProduct(stripe, plan, display.name, display.tagline);

  // ---- 2. Build the desired Price body ----
  const desired = buildPriceCreatePayload(plan, prices);

  // ---- 3. Find an existing matching Price ----
  const existing = await findCurrentPrice(stripe, product.id, plan);
  if (existing && pricesEquivalent(existing, desired)) {
    return { plan, productId: product.id, priceId: existing.id, changed: false };
  }

  // ---- 4. Create the new Price, archive the old one if present ----
  const created = await stripe.prices.create({
    ...desired,
    product: product.id,
  });
  if (existing) {
    await stripe.prices.update(existing.id, { active: false });
  }
  return { plan, productId: product.id, priceId: created.id, changed: true };
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
        p.metadata?.[PRODUCT_KEY] === plan && p.metadata?.[PRICE_ROLE_KEY] === PRICE_ROLE_VALUE,
    ) ?? null
  );
}

type CreateCurrencyOptionsMap = {
  [key: string]: Stripe.PriceCreateParams.CurrencyOptions;
};

function buildPriceCreatePayload(
  plan: Plan,
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
  return {
    currency: CURRENCY_META[baseCurrency].stripeCode,
    unit_amount: prices[baseCurrency] * 100,
    recurring: { interval: "month" },
    nickname: `Repodcast ${plan} (multi-currency)`,
    metadata: {
      [PRODUCT_KEY]: plan,
      [PRICE_ROLE_KEY]: PRICE_ROLE_VALUE,
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
function pricesEquivalent(existing: Stripe.Price, desired: Stripe.PriceCreateParams): boolean {
  if (existing.currency !== desired.currency) return false;
  if (existing.unit_amount !== desired.unit_amount) return false;
  if (existing.recurring?.interval !== "month") return false;
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
