import "server-only";

import Stripe from "stripe";

// Pin to the API version the installed SDK ships with — keeps the request
// shapes consistent. Bump this when upgrading the `stripe` package (cf.
// `node_modules/stripe/cjs/apiVersion.js`).
const STRIPE_API_VERSION = "2026-06-24.dahlia" as const;

let _stripe: Stripe | null = null;

/**
 * Lazy Stripe client. Returns `null` when `STRIPE_SECRET_KEY` is unset so
 * dev / `next build` succeed on a fresh clone; callers that *must* hit
 * Stripe (server actions, webhook) call `requireStripeClient()` instead.
 *
 * Pin the SDK's bundled `Stripe.LATEST_API_VERSION` so the response shapes
 * the SDK ships with match what the runtime returns.
 */
export function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!_stripe) {
    _stripe = new Stripe(key, {
      apiVersion: STRIPE_API_VERSION,
      typescript: true,
    });
  }
  return _stripe;
}

export function requireStripeClient(): Stripe {
  const client = getStripeClient();
  if (!client) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  return client;
}

export { Stripe };
