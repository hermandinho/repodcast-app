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
import { requireStripeClient, Stripe } from "@/server/billing/stripe";
import { trackServer } from "@/server/analytics/track";

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

// changePlanAction path: cadence stays optional (no default). If the
// caller omits it we preserve the sub's existing cadence — defaulting
// silently to MONTHLY would downgrade an annual sub.
const changePlanInput = z.object({
  plan: z.nativeEnum(Plan),
  currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  cadence: z.nativeEnum(BillingCadence).optional(),
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
    select: { preferredCurrency: true, plan: true },
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

  // Funnel signal. Fired synchronously so it lands before we
  // redirect the user to Stripe's hosted page; `trackServer` bounds itself
  // to 2s so a PostHog outage can't slow the checkout kick-off.
  await trackServer(
    "upgrade_started",
    {
      agencyId: auth.agency.id,
      fromPlan: agency?.plan ?? Plan.STUDIO,
      toPlan: plan,
      cadence,
      currency: resolvedCurrency,
    },
    { distinctId: `agency:${auth.agency.id}`, agencyId: auth.agency.id },
  );

  return { ok: true, data: { url: session.url } };
}

/**
 * In-place plan change on an existing Stripe subscription — no fresh
 * Checkout, no card re-entry. Two paths:
 *
 *   - **Trialing → paid**: `trial_end: 'now'` ends the trial immediately
 *     and Stripe attempts the first plan charge against the saved card.
 *     `payment_behavior: 'error_if_incomplete'` means a declined card
 *     rolls the update back — the agency stays on trial rather than
 *     silently getting upgraded access without paying. `syncSubscription`
 *     on the webhook then flips `trialStatus` to CONVERTED.
 *
 *   - **Paid → paid** (or paid → Solo downgrade): standard
 *     `create_prorations` — the current period's remaining time credits
 *     against the new plan's remaining-period charge on the next invoice.
 *
 * Eager DB write for `plan` + `billingCadence` so the UI reflects the new
 * tier without waiting for the webhook. The webhook re-writes the same
 * values on `customer.subscription.updated`, idempotent.
 */
export async function changePlanAction(
  raw: unknown,
): Promise<ActionResult<{ plan: Plan; cadence: BillingCadence; fromTrial: boolean }>> {
  const parsed = changePlanInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid plan input", parsed.error.issues);
  }
  const { plan } = parsed.data;

  const auth = await requireAuthContext();
  assertRole(auth, ["OWNER", "ADMIN"]);

  const agency = await prisma.agency.findUnique({
    where: { id: auth.agency.id },
    select: {
      plan: true,
      billingCadence: true,
      preferredCurrency: true,
      stripeSubscriptionId: true,
    },
  });
  if (!agency?.stripeSubscriptionId) {
    return {
      ok: false,
      error: "No active subscription — start one via checkout first.",
    };
  }

  const cadence = parsed.data.cadence ?? agency.billingCadence;
  const newPriceId = priceIdFor(plan, cadence);
  if (!newPriceId) {
    return {
      ok: false,
      error: `No Stripe price configured for ${plan} (${cadence}). Set NEXT_PUBLIC_STRIPE_${plan}_${cadence}_PRICE_ID.`,
    };
  }

  const resolvedCurrency =
    parsed.data.currency ?? asSupportedCurrency(agency.preferredCurrency) ?? DEFAULT_CURRENCY;

  const stripe = requireStripeClient();
  const sub = await stripe.subscriptions.retrieve(agency.stripeSubscriptionId);
  const currentItem = sub.items.data[0];
  if (!currentItem) {
    return { ok: false, error: "Subscription has no line items — contact support." };
  }
  if (currentItem.price.id === newPriceId) {
    return { ok: false, error: "You're already on this plan." };
  }

  const fromTrial = sub.status === "trialing";
  // Auto-resume: if the sub is scheduled to cancel and the user actively
  // changes plan, they clearly want to keep going. Flip
  // `cancel_at_period_end: false` in the same update so the reload
  // shows a normal, non-canceling sub instead of confusingly leaving
  // the "ending soon" banner up on a freshly-upgraded plan.
  const wasScheduledToCancel = sub.cancel_at_period_end === true;
  try {
    await stripe.subscriptions.update(agency.stripeSubscriptionId, {
      items: [{ id: currentItem.id, price: newPriceId }],
      proration_behavior: "create_prorations",
      // Preserve any existing keys (source markers, currency, etc.) — the
      // Stripe SDK replaces `metadata` wholesale on update.
      metadata: {
        ...(sub.metadata ?? {}),
        agencyId: auth.agency.id,
        plan,
        cadence,
        currency: resolvedCurrency,
      },
      ...(wasScheduledToCancel ? { cancel_at_period_end: false } : {}),
      ...(fromTrial
        ? {
            trial_end: "now" as const,
            payment_behavior: "error_if_incomplete" as const,
          }
        : {}),
    });
  } catch (err) {
    // `error_if_incomplete` throws a StripeCardError-family error when the
    // saved card is declined on the trial-end charge. Surface a clean
    // message rather than the raw Stripe payload.
    const message =
      err instanceof Error && "type" in err && (err as { type?: string }).type === "StripeCardError"
        ? "Your saved card was declined. Update it in Manage subscription and try again."
        : err instanceof Error
          ? err.message
          : "Couldn't switch plan.";
    return { ok: false, error: message };
  }

  // Eager DB write so the billing page + limits reflect the new tier
  // without waiting for the webhook. When `fromTrial`, we know the charge
  // succeeded (else `error_if_incomplete` would have thrown above), so
  // we can flip trialStatus → CONVERTED here too and the trial pill
  // disappears on the reload. The webhook re-writes both idempotently.
  await prisma.agency.update({
    where: { id: auth.agency.id },
    data: {
      plan,
      billingCadence: cadence,
      ...(wasScheduledToCancel ? { subscriptionCancelAt: null } : {}),
      ...(fromTrial ? { trialStatus: "CONVERTED" as const } : {}),
    },
  });

  await trackServer(
    "plan_switched",
    {
      agencyId: auth.agency.id,
      fromPlan: agency.plan,
      toPlan: plan,
      cadence,
      currency: resolvedCurrency,
      fromTrial,
    },
    { distinctId: `agency:${auth.agency.id}`, agencyId: auth.agency.id },
  );

  revalidatePath("/settings/billing");
  return { ok: true, data: { plan, cadence, fromTrial } };
}

/**
 * Schedule the active subscription for cancellation at period-close.
 * Flips Stripe's `cancel_at_period_end: true` — the user keeps their
 * paid access until the current period ends, at which point Stripe
 * fires `customer.subscription.deleted` and our webhook nulls
 * `stripeSubscriptionId` + drops the agency back to SOLO.
 *
 * The paired `resumeSubscriptionAction` flips it back until the period
 * ends. Once Stripe deletes the sub, resume is no longer possible —
 * the user has to resubscribe via a fresh Checkout (plan tiles route
 * that path when `hasSubscription` is false).
 *
 * We do NOT call `stripe.subscriptions.cancel()` — that would delete
 * the sub immediately and forfeit the paid-period days the user
 * already paid for. The dunning behavior on the Stripe side matches
 * what the Customer Portal does when a user hits "Cancel plan".
 */
export async function cancelSubscriptionAction(): Promise<
  ActionResult<{ cancelAt: string | null }>
> {
  const auth = await requireAuthContext();
  assertRole(auth, ["OWNER", "ADMIN"]);

  const agency = await prisma.agency.findUnique({
    where: { id: auth.agency.id },
    select: { stripeSubscriptionId: true, subscriptionCancelAt: true },
  });
  if (!agency?.stripeSubscriptionId) {
    return { ok: false, error: "No active subscription to cancel." };
  }
  if (agency.subscriptionCancelAt) {
    return { ok: false, error: "Subscription is already scheduled to cancel." };
  }

  const stripe = requireStripeClient();
  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.update(agency.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't cancel subscription.",
    };
  }

  // Eager DB mirror so the SubscriptionStatusCard shows immediately on
  // reload. `sub.cancel_at` is set by Stripe; fall back to the item-
  // level `current_period_end` if not (older API responses).
  const cancelAt =
    sub.cancel_at !== null && sub.cancel_at !== undefined
      ? new Date(sub.cancel_at * 1000)
      : sub.items.data[0]?.current_period_end
        ? new Date(sub.items.data[0].current_period_end * 1000)
        : null;
  await prisma.agency.update({
    where: { id: auth.agency.id },
    data: { subscriptionCancelAt: cancelAt },
  });

  revalidatePath("/settings/billing");
  return { ok: true, data: { cancelAt: cancelAt?.toISOString() ?? null } };
}

/**
 * Un-cancel a subscription scheduled to end at period-close. Flips the
 * Stripe `cancel_at_period_end` flag back to `false`, mirrors the state
 * to the DB, and revalidates the billing page. No proration, no invoice
 * — Stripe just keeps the sub going and bills as normal at the next
 * cycle. The corresponding "cancel" happens via the Stripe Customer
 * Portal (`createPortalSessionAction`); we don't own that direction.
 */
export async function resumeSubscriptionAction(): Promise<ActionResult<void>> {
  const auth = await requireAuthContext();
  assertRole(auth, ["OWNER", "ADMIN"]);

  const agency = await prisma.agency.findUnique({
    where: { id: auth.agency.id },
    select: { stripeSubscriptionId: true, subscriptionCancelAt: true },
  });
  if (!agency?.stripeSubscriptionId) {
    return {
      ok: false,
      error: "No active subscription to resume. Pick a plan below to resubscribe.",
    };
  }
  if (!agency.subscriptionCancelAt) {
    return { ok: false, error: "Subscription isn't scheduled to cancel." };
  }

  const stripe = requireStripeClient();
  try {
    await stripe.subscriptions.update(agency.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't resume subscription.",
    };
  }

  // Eager DB mirror — the webhook `syncSubscription` will re-write null
  // on the resulting `customer.subscription.updated`, idempotent.
  await prisma.agency.update({
    where: { id: auth.agency.id },
    data: { subscriptionCancelAt: null },
  });

  revalidatePath("/settings/billing");
  return { ok: true, data: undefined };
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
