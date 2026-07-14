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
import { isTrialEligiblePlan, PLAN_DISPLAY, TRIAL_ACTIVATION_FEE_CENTS } from "@/lib/plans";
import { trackServer } from "@/server/analytics/track";
import { requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { priceIdFor } from "@/server/billing/prices";
import { Stripe, requireStripeClient } from "@/server/billing/stripe";
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
 * Onboarding-side variant of `createCheckoutSessionAction`. Two Checkout
 * shapes depending on whether the user qualifies for the Solo $1 trial:
 *
 *   - **Solo trial-eligible** (Solo pick, no prior Stripe customer, no
 *     prior trial): `mode: 'payment'` for a $1 activation charge with
 *     `setup_future_usage: 'off_session'`. Stripe UI shows "$1 due
 *     today", the charge lands as a real PaymentIntent (not a deferred
 *     invoice), and the card gets saved. The `checkout.session.completed`
 *     webhook then creates the actual subscription with `trial_period_days:
 *     7` + the saved payment method — the subscription enters `trialing`
 *     status and our normal `syncSubscription` handler stamps the agency's
 *     trial state.
 *
 *   - **Everyone else** (Studio, Network, or returning Solo customer
 *     re-subscribing after a trial burn): `mode: 'subscription'` with an
 *     immediate charge, no trial. Same shape as the classic Checkout.
 *
 * Success redirects to /onboarding/return (which polls until the sub
 * shows up in the DB, then forwards to /dashboard). Cancel returns to
 * /onboarding/plan so the user can pick again.
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
    select: {
      preferredCurrency: true,
      stripeSubscriptionId: true,
      stripeCustomerId: true,
      trialStatus: true,
    },
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

  // Trial-eligibility: SOLO or STUDIO, one trial per Stripe customer.
  //
  // The trial ladder mirrors the pricing table: entry-tier buyers get
  // the $1/7-day trial so they can commit before paying full price;
  // AGENCY and NETWORK buyers subscribe directly (higher-intent buyers,
  // and caps trial abuse at scale). Which plans qualify lives in
  // `lib/plans.ts` — the checkout shape here reads from that constant
  // so a future tier change doesn't require touching this file.
  //
  // Second-trial ban: `stripeCustomerId` set OR a non-NONE `trialStatus`
  // means the customer has already burned their one trial.
  const trialEligible =
    isTrialEligiblePlan(plan) &&
    !agency?.stripeCustomerId &&
    (agency?.trialStatus ?? "NONE") === "NONE";

  const stripe = requireStripeClient();
  const url = await baseUrl();
  const returnParams = new URLSearchParams({ plan, cadence, currency: resolvedCurrency });

  const sharedMetadata = {
    agencyId: auth.agency.id,
    plan,
    cadence,
    currency: resolvedCurrency,
    trial_activation: trialEligible ? "true" : "false",
  };

  const session = trialEligible
    ? await createTrialCheckout({
        stripe,
        auth,
        currency: resolvedCurrency,
        priceId,
        plan,
        successUrl: `${url}/onboarding/return?${returnParams.toString()}`,
        cancelUrl: `${url}/onboarding/plan?${returnParams.toString()}`,
        metadata: sharedMetadata,
      })
    : await createDirectSubscriptionCheckout({
        stripe,
        auth,
        currency: resolvedCurrency,
        priceId,
        successUrl: `${url}/onboarding/return?${returnParams.toString()}`,
        cancelUrl: `${url}/onboarding/plan?${returnParams.toString()}`,
        metadata: sharedMetadata,
      });

  if (!session.url) {
    throw new Error("Stripe did not return a Checkout URL.");
  }

  // Funnel event. Step 2 completion happens when the user
  // successfully clicks a plan CTA; the actual conversion is `trial_started`
  // or `upgrade_completed` which fire from the Stripe webhook.
  void trackServer(
    "onboarding_step_completed",
    { agencyId: auth.agency.id, step: 2, stepName: "plan" },
    { distinctId: `agency:${auth.agency.id}`, agencyId: auth.agency.id },
  );

  redirect(session.url);
}

// ============================================================
// Trial checkout: mode:'payment' — charge $1 today, save card,
// create subscription in webhook. Used for Solo + Studio picks.
// ============================================================

async function createTrialCheckout(args: {
  stripe: Stripe;
  auth: { user: { email: string }; agency: { id: string } };
  currency: (typeof SUPPORTED_CURRENCIES)[number];
  priceId: string;
  plan: Plan;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}): Promise<Stripe.Checkout.Session> {
  const { stripe, auth, currency, priceId, plan, successUrl, cancelUrl, metadata } = args;

  // Stripe UI needs a concrete product/price line item to render "$1 due
  // today". We use `price_data` (inline) rather than a persisted Price so
  // there's no bookkeeping in Stripe products/prices for the activation
  // fee — the fee amount is baked into `TRIAL_ACTIVATION_FEE_CENTS` at
  // the app layer, single source of truth.
  const planName = PLAN_DISPLAY[plan].name;
  const planUsdMonthly = PLAN_DISPLAY[plan].prices.monthly.USD;
  return stripe.checkout.sessions.create({
    mode: "payment",
    currency: CURRENCY_META[currency].stripeCode,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: CURRENCY_META[currency].stripeCode,
          unit_amount: TRIAL_ACTIVATION_FEE_CENTS,
          product_data: {
            name: `${planName} trial activation`,
            description: `$1 non-refundable activation fee. Your ${planName} plan ($${planUsdMonthly}/mo) starts on day 8 unless you cancel first.`,
          },
        },
      },
    ],
    // Force a customer so the webhook can attach the subscription that
    // follows. Guest-mode payments don't create a Customer object.
    customer_email: auth.user.email || undefined,
    customer_creation: "always",
    // Save the card so we can charge the recurring plan against it when
    // the trial ends. `off_session` is the right choice — the day-8 charge
    // fires without user interaction.
    payment_intent_data: {
      setup_future_usage: "off_session",
      description: "Repodcast Solo trial activation ($1)",
      metadata: { ...metadata, plan_price_id: priceId },
    },
    metadata: { ...metadata, plan_price_id: priceId },
    client_reference_id: auth.agency.id,
    success_url: successUrl,
    cancel_url: cancelUrl,
    submit_type: "pay",
  });
}

// ============================================================
// Non-trial path: mode:'subscription' — immediate recurring charge,
// no trial period.
// ============================================================

async function createDirectSubscriptionCheckout(args: {
  stripe: Stripe;
  auth: { user: { email: string }; agency: { id: string } };
  currency: (typeof SUPPORTED_CURRENCIES)[number];
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}): Promise<Stripe.Checkout.Session> {
  const { stripe, auth, currency, priceId, successUrl, cancelUrl, metadata } = args;

  return stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    currency: CURRENCY_META[currency].stripeCode,
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: auth.user.email || undefined,
    client_reference_id: auth.agency.id,
    metadata,
    subscription_data: { metadata },
    allow_promotion_codes: true,
  });
}
