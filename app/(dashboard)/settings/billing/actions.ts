"use server";

import { headers } from "next/headers";
import { Plan } from "@prisma/client";
import { z } from "zod";
import { requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { assertRole } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import { priceIdFor } from "@/server/billing/prices";
import { requireStripeClient } from "@/server/billing/stripe";

const checkoutInput = z.object({ plan: z.nativeEnum(Plan) });

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
  const { plan } = parsed.data;

  const auth = await requireAuthContext();
  assertRole(auth, ["OWNER", "ADMIN"]);

  const priceId = priceIdFor(plan);
  if (!priceId) {
    return {
      ok: false,
      error: `No Stripe price configured for ${plan}. Set NEXT_PUBLIC_STRIPE_${plan}_PRICE_ID.`,
    };
  }

  const stripe = requireStripeClient();
  const url = await baseUrl();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${url}/settings/billing?success=true`,
    cancel_url: `${url}/settings/billing?canceled=true`,
    customer_email: auth.user.email || undefined,
    client_reference_id: auth.agency.id,
    metadata: { agencyId: auth.agency.id, plan },
    subscription_data: {
      metadata: { agencyId: auth.agency.id, plan },
    },
    allow_promotion_codes: true,
  });

  if (!session.url) {
    return { ok: false, error: "Stripe did not return a checkout URL." };
  }
  return { ok: true, data: { url: session.url } };
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
