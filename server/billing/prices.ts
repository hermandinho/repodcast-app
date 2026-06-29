import "server-only";

import { Plan } from "@prisma/client";

/**
 * Map our Plan enum to the Stripe Price IDs configured in the dashboard.
 * Set these via `NEXT_PUBLIC_STRIPE_*_PRICE_ID` so client + server agree
 * on the IDs (Stripe Checkout doesn't expose them through any API).
 */
export function priceIdFor(plan: Plan): string | null {
  switch (plan) {
    case Plan.STUDIO:
      return process.env.NEXT_PUBLIC_STRIPE_STUDIO_PRICE_ID || null;
    case Plan.AGENCY:
      return process.env.NEXT_PUBLIC_STRIPE_AGENCY_PRICE_ID || null;
    case Plan.NETWORK:
      return process.env.NEXT_PUBLIC_STRIPE_NETWORK_PRICE_ID || null;
  }
}

/**
 * Reverse lookup: given the Price ID Stripe sends in webhook payloads,
 * derive which Plan the subscription represents. Returns null if the ID
 * doesn't match any configured tier (e.g. a legacy price).
 */
export function planForPriceId(priceId: string): Plan | null {
  const map = new Map<string, Plan>();
  const s = process.env.NEXT_PUBLIC_STRIPE_STUDIO_PRICE_ID;
  const a = process.env.NEXT_PUBLIC_STRIPE_AGENCY_PRICE_ID;
  const n = process.env.NEXT_PUBLIC_STRIPE_NETWORK_PRICE_ID;
  if (s) map.set(s, Plan.STUDIO);
  if (a) map.set(a, Plan.AGENCY);
  if (n) map.set(n, Plan.NETWORK);
  return map.get(priceId) ?? null;
}
