"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BillingCadence, Plan } from "@/lib/enums";
import { requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { assertRole } from "@/server/auth/context";
import { toTenantContext } from "@/server/auth/tenant";
import {
  asSupportedCurrency,
  CURRENCY_META,
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
} from "@/lib/currencies";
import { prisma } from "@/server/db/client";
import { updatePreferredCurrency, updatePreferredCurrencyInput } from "@/server/db/agencies";
import { priceIdFor } from "@/server/billing/prices";
import { requireStripeClient } from "@/server/billing/stripe";

const checkoutInput = z.object({
  plan: z.nativeEnum(Plan),
  /**
   * Optional override; defaults to `Agency.preferredCurrency`. The Stripe
   * Price for each plan carries `currency_options` for every code in
   * `SUPPORTED_CURRENCIES`, so Checkout switches by this param.
   */
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  /** Monthly vs annual. Defaults to MONTHLY for back-compat. */
  cadence: z.nativeEnum(BillingCadence).default(BillingCadence.MONTHLY),
});

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

async function baseUrl(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

/**
 * Build a Stripe Checkout Session and return its hosted URL. The caller
 * (client component) opens it via `window.location.href = url`.
 *
 * We pass `client_reference_id` + metadata so the webhook can map the
 * resulting subscription back to the Agency.
 */
export async function createCheckoutSessionAction(
  raw: unknown,
): Promise<ActionResult<{ url: string }>> {
  const parsed = checkoutInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid checkout input", parsed.error.issues);
  }
  const { plan, cadence } = parsed.data;

  const auth = await requireAuthContext();
  assertRole(auth, ["OWNER", "ADMIN"]);

  // Resolve the currency in this order:
  //   1. Explicit param from the picker on /settings/billing.
  //   2. The agency's stored preferredCurrency (falls back to USD).
  // The Stripe Price object carries `currency_options` for every supported
  // currency, so the same price id works for all of them — Checkout picks
  // the one we pass via the `currency` param.
  const agency = await prisma.agency.findUnique({
    where: { id: auth.agency.id },
    select: { preferredCurrency: true },
  });
  const resolvedCurrency =
    parsed.data.currency ?? asSupportedCurrency(agency?.preferredCurrency) ?? DEFAULT_CURRENCY;

  const priceId = priceIdFor(plan, cadence);
  if (!priceId) {
    return {
      ok: false,
      error: `No Stripe price configured for ${plan} (${cadence}). Set NEXT_PUBLIC_STRIPE_${plan}_${cadence}_PRICE_ID.`,
    };
  }

  const stripe = requireStripeClient();
  const url = await baseUrl();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    // Checkout picks this currency from the Price's `currency_options`.
    // Stripe requires lowercase ISO-4217 in API payloads.
    currency: CURRENCY_META[resolvedCurrency].stripeCode,
    success_url: `${url}/settings/billing?success=true`,
    cancel_url: `${url}/settings/billing?canceled=true`,
    customer_email: auth.user.email || undefined,
    client_reference_id: auth.agency.id,
    metadata: { agencyId: auth.agency.id, plan, cadence, currency: resolvedCurrency },
    subscription_data: {
      metadata: { agencyId: auth.agency.id, plan, cadence, currency: resolvedCurrency },
    },
    allow_promotion_codes: true,
  });

  if (!session.url) {
    return { ok: false, error: "Stripe did not return a checkout URL." };
  }
  return { ok: true, data: { url: session.url } };
}

/**
 * Update the agency's preferred currency. Powers the picker on
 * /settings/billing — the next `createCheckoutSessionAction` (and every
 * plan card render) reads from the new value. OWNER/ADMIN gated at the
 * repo layer.
 */
export async function updatePreferredCurrencyAction(
  raw: unknown,
): Promise<ActionResult<{ currency: string }>> {
  const parsed = updatePreferredCurrencyInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid currency", parsed.error.issues);
  }
  const auth = await requireAuthContext();
  const updated = await updatePreferredCurrency(toTenantContext(auth), parsed.data);
  revalidatePath("/settings/billing");
  return { ok: true, data: { currency: updated.preferredCurrency } };
}

/**
 * Return a hosted Stripe Customer Portal URL so the user can manage their
 * existing subscription (change plan, update card, cancel).
 */
export async function createPortalSessionAction(): Promise<ActionResult<{ url: string }>> {
  const auth = await requireAuthContext();
  assertRole(auth, ["OWNER", "ADMIN"]);

  const agency = await prisma.agency.findUnique({
    where: { id: auth.agency.id },
    select: { stripeCustomerId: true },
  });
  if (!agency?.stripeCustomerId) {
    return {
      ok: false,
      error: "No Stripe customer linked to this agency yet — start with a checkout.",
    };
  }

  const stripe = requireStripeClient();
  const url = await baseUrl();
  const session = await stripe.billingPortal.sessions.create({
    customer: agency.stripeCustomerId,
    return_url: `${url}/settings/billing`,
  });
  return { ok: true, data: { url: session.url } };
}
