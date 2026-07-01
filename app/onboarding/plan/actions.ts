"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  asSupportedCurrency,
  CURRENCY_META,
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
} from "@/lib/currencies";
import { BillingCadence, Plan } from "@/lib/enums";
import { requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { priceIdFor } from "@/server/billing/prices";
import { requireStripeClient } from "@/server/billing/stripe";
import { isLiveDb } from "@/server/data/source";
import { prisma } from "@/server/db/client";

const checkoutInput = z.object({
  plan: z.nativeEnum(Plan),
  cadence: z.nativeEnum(BillingCadence),
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
});

async function baseUrl(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

/**
 * Onboarding-side variant of `createCheckoutSessionAction`. Same Stripe
 * plumbing, different UX contract:
 *
 *   - Success redirects to /onboarding/return (which polls for the
 *     webhook, then forwards to /dashboard) — not back to /settings.
 *   - Cancel returns to /onboarding/plan so the user can pick again.
 *   - Called with FormData from the `<PricingPicker mode="onboarding">`
 *     forms, so the input types come in as strings.
 *
 * We keep the action co-located with the plan page rather than pointing
 * back at /settings/billing/actions because the success/cancel URLs
 * differ. The two actions share the pricing math + Stripe call shape
 * via `priceIdFor`.
 */
export async function checkoutFromOnboardingAction(formData: FormData): Promise<void> {
  const parsed = checkoutInput.safeParse({
    plan: formData.get("plan"),
    cadence: formData.get("cadence"),
    currency: formData.get("currency") ?? undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("Invalid plan input", parsed.error.issues);
  }
  const { plan, cadence } = parsed.data;

  if (!isLiveDb()) {
    // Sample-data mode: pretend Stripe accepted, jump to the return page.
    redirect(`/onboarding/return?plan=${plan}&cadence=${cadence}`);
  }

  const auth = await requireAuthContext();

  const agency = await prisma.agency.findUnique({
    where: { id: auth.agency.id },
    select: { preferredCurrency: true, stripeSubscriptionId: true },
  });

  // Guard against double-charging: if the webhook already stamped a sub on
  // this agency between form render and submit, jump straight to dashboard.
  if (agency?.stripeSubscriptionId) {
    redirect("/dashboard");
  }

  const resolvedCurrency =
    parsed.data.currency ?? asSupportedCurrency(agency?.preferredCurrency) ?? DEFAULT_CURRENCY;

  const priceId = priceIdFor(plan, cadence);
  if (!priceId) {
    throw new Error(
      `No Stripe price configured for ${plan} (${cadence}). Set NEXT_PUBLIC_STRIPE_${plan}_${cadence}_PRICE_ID.`,
    );
  }

  const stripe = requireStripeClient();
  const url = await baseUrl();
  const returnParams = new URLSearchParams({ plan, cadence, currency: resolvedCurrency });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    currency: CURRENCY_META[resolvedCurrency].stripeCode,
    success_url: `${url}/onboarding/return?${returnParams.toString()}`,
    cancel_url: `${url}/onboarding/plan?${returnParams.toString()}`,
    customer_email: auth.user.email || undefined,
    client_reference_id: auth.agency.id,
    metadata: { agencyId: auth.agency.id, plan, cadence, currency: resolvedCurrency },
    subscription_data: {
      metadata: { agencyId: auth.agency.id, plan, cadence, currency: resolvedCurrency },
    },
    allow_promotion_codes: true,
  });

  if (!session.url) {
    throw new Error("Stripe did not return a Checkout URL.");
  }

  redirect(session.url);
}
