/**
 * Single source of truth for the currencies Repodcast supports — both for
 * the agency→client billing metadata (`ClientBillingProfile.currency`) and
 * for Repodcast's own SaaS subscription plans.
 *
 * Adding a currency = append it here, top up `PLAN_PRICES_BY_CURRENCY` in
 * `lib/plans.ts`, and re-run `scripts/configure-stripe-plans.ts` so the
 * Stripe Price's `currency_options` picks it up. Nothing else needs to
 * change.
 */

export const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export type CurrencyMeta = {
  code: SupportedCurrency;
  /** Stripe wants lowercase ISO-4217 in API payloads. */
  stripeCode: string;
  /** UI symbol; uses the canonical regional glyph where it disambiguates. */
  symbol: string;
  /** Human-readable name for picker labels. */
  label: string;
};

export const CURRENCY_META: Record<SupportedCurrency, CurrencyMeta> = {
  USD: { code: "USD", stripeCode: "usd", symbol: "$", label: "US Dollar" },
  EUR: { code: "EUR", stripeCode: "eur", symbol: "€", label: "Euro" },
  GBP: { code: "GBP", stripeCode: "gbp", symbol: "£", label: "British Pound" },
  CAD: { code: "CAD", stripeCode: "cad", symbol: "CA$", label: "Canadian Dollar" },
  AUD: { code: "AUD", stripeCode: "aud", symbol: "A$", label: "Australian Dollar" },
};

export const DEFAULT_CURRENCY: SupportedCurrency = "USD";

/**
 * Normalise a free-form input to a SupportedCurrency, or return null if it
 * isn't one we accept. Falls through case-insensitively.
 */
export function asSupportedCurrency(value: string | null | undefined): SupportedCurrency | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(upper)
    ? (upper as SupportedCurrency)
    : null;
}

/**
 * Format a whole-currency amount for display. We deliberately omit decimal
 * fractions on the plan cards (prices are whole-currency by design).
 */
export function formatPlanPrice(amount: number, currency: SupportedCurrency): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
