import { type BillingCadence, InvoiceStatus, type Plan, TrialStatus } from "@prisma/client";
import { headers } from "next/headers";
import { trackServer } from "@/server/analytics/track";
import { TRIAL_DAYS } from "@/lib/plans";
import { planAndCadenceForPriceId, priceIdFor } from "@/server/billing/prices";
import { Stripe, requireStripeClient } from "@/server/billing/stripe";
import { prisma } from "@/server/db/client";
import { markWebhookProcessed, unmarkWebhookProcessed } from "@/server/db/webhook-deliveries";
import { captureWebhookFailure } from "@/server/observability/sentry";
import {
  sendTrialConvertedEmail,
  sendTrialEndingSoonEmail,
  sendTrialExpiredEmail,
  sendTrialWelcomeEmail,
} from "@/server/email/send";

// Webhook handlers must never be cached.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      "[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set — no webhook events will process. " +
        "In dev: run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` and paste the " +
        "printed whsec_ into .env.local, then restart the dev server. In prod: paste the secret " +
        "from Dashboard → Developers → Webhooks → Endpoint details → Signing secret.",
    );
    return new Response("server misconfigured", { status: 500 });
  }

  const sig = (await headers()).get("stripe-signature");
  if (!sig) return new Response("missing signature", { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    const stripe = requireStripeClient();
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.warn(
      "[stripe-webhook] signature verification failed — the `whsec_` in STRIPE_WEBHOOK_SECRET " +
        "doesn't match the endpoint signing this event. In dev, this usually means you copied " +
        "the wrong secret (each `stripe listen` invocation prints a new one) or restarted the " +
        "listener without updating .env.local.",
      err,
    );
    return new Response("invalid signature", { status: 400 });
  }

  // Log every accepted event so operators can confirm end-to-end
  // delivery when diagnosing (e.g. "did checkout.session.completed
  // actually reach us?"). Cheap and quiet — no PII.
  console.log("[stripe-webhook] received", { type: event.type, id: event.id });

  // Idempotency: claim this event's id in the dedupe ledger *before*
  // dispatching. Stripe retries on non-2xx, so the same `event.id` can
  // arrive multiple times — without this we'd double-apply plan changes,
  // resync invoices repeatedly, and rack up redundant writes. Concurrent
  // deliveries collapse on the unique constraint; the loser short-circuits.
  const claim = await markWebhookProcessed("stripe", event.id, event.type);
  if (claim.deduped) {
    console.log("[stripe-webhook] deduped", { type: event.type, id: event.id });
    return new Response(null, { status: 204 });
  }

  try {
    await dispatch(event);
  } catch (err) {
    console.error("[stripe-webhook] handler failed", {
      type: event.type,
      err,
    });
    captureWebhookFailure("stripe_webhook", err, { eventType: event.type, eventId: event.id });
    // Roll the ledger row back so Stripe's next retry re-processes — the
    // transient failure shouldn't permanently de-dupe a legitimate event.
    await unmarkWebhookProcessed("stripe", event.id);
    return new Response("handler error", { status: 500 });
  }

  return new Response(null, { status: 204 });
}

async function dispatch(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "customer.subscription.created":
      await syncSubscription(event.data.object as Stripe.Subscription, {
        fireUpgradeCompleted: true,
      });
      return;
    case "customer.subscription.updated":
      await syncSubscription(event.data.object as Stripe.Subscription, {
        fireUpgradeCompleted: false,
      });
      return;

    case "customer.subscription.trial_will_end":
      await handleTrialWillEnd(event.data.object as Stripe.Subscription);
      return;

    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
      return;

    // Fires when a Checkout Session completes successfully. We use this to
    // land the $1 Solo trial activation fee as a SEPARATE immediate invoice
    // — Stripe defers any one-time `line_items` inside a subscription-mode
    // Checkout to the trial-end invoice, which would defeat the whole
    // "sunk-cost commitment" purpose of the fee.
    case "checkout.session.completed":
      await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
      return;

    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.finalized":
      await upsertInvoice(event.data.object as Stripe.Invoice);
      return;

    default:
      return;
  }
}

// ============================================================
// Subscription handlers
// ============================================================

async function syncSubscription(
  sub: Stripe.Subscription,
  { fireUpgradeCompleted }: { fireUpgradeCompleted: boolean },
): Promise<void> {
  const agencyId = sub.metadata?.agencyId;
  if (!agencyId) {
    console.warn("[stripe-webhook] subscription has no agencyId metadata", {
      id: sub.id,
    });
    return;
  }

  // Derive the (Plan, BillingCadence) from the subscription's primary line
  // item. The Price ID is the source of truth — `sub.metadata.plan` may
  // disagree if Stripe-side admin tooling reassigned the sub.
  const priceId = sub.items.data[0]?.price.id;
  const match = priceId ? planAndCadenceForPriceId(priceId) : null;
  if (!match) {
    console.warn("[stripe-webhook] no Plan mapping for price", { priceId });
    return;
  }
  const plan: Plan = match.plan;
  const billingCadence: BillingCadence = match.cadence;

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  // Trial state. Read the current row so we can detect the
  // transition `ACTIVE → CONVERTED` (`trialing → active` on first successful
  // charge). Other transitions land here too: a `trialing` sub → ACTIVE, a
  // paid sub with no trial → leave trial fields alone.
  const current = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { trialStatus: true },
  });

  const trialUpdate: {
    trialStatus?: TrialStatus;
    trialEndsAt?: Date | null;
  } = {};
  if (sub.status === "trialing" && sub.trial_end) {
    trialUpdate.trialStatus = TrialStatus.ACTIVE;
    trialUpdate.trialEndsAt = new Date(sub.trial_end * 1000);
  } else if (sub.status === "active" && current?.trialStatus === TrialStatus.ACTIVE) {
    // First-invoice charge succeeded → trial converted. Keep trialEndsAt
    // stamped for history (surfaces "converted on [date]" on billing page).
    trialUpdate.trialStatus = TrialStatus.CONVERTED;
  }

  // "Cancel scheduled" state — surfaced on /settings/billing with the
  // effective end-date + a Resume button that flips `cancel_at_period_end`
  // back to false. Prefer `sub.cancel_at` (Stripe fills this on cancel-
  // at-period-end); fall back to the item-level `current_period_end` if
  // the flag is set but `cancel_at` is null (older API responses). Reset
  // to null when the flag is false so a resumed sub clears the banner.
  const cancelAt: Date | null =
    sub.cancel_at !== null && sub.cancel_at !== undefined
      ? new Date(sub.cancel_at * 1000)
      : sub.cancel_at_period_end && sub.items.data[0]?.current_period_end
        ? new Date(sub.items.data[0].current_period_end * 1000)
        : null;

  const discount = await resolveActiveDiscount(sub);

  await prisma.agency.update({
    where: { id: agencyId },
    data: {
      plan,
      billingCadence,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      subscriptionCancelAt: cancelAt,
      activeDiscountLabel: discount.label,
      activeDiscountEndsAt: discount.endsAt,
      ...trialUpdate,
    },
  });

  // Upgrade funnel completion. Only fires on
  // `customer.subscription.created` (not on updates) so the funnel
  // metric doesn't double-count every subscription mutation. The
  // webhook is the authoritative signal: client redirects lie
  // (users close the tab, Stripe retries, etc.).
  if (fireUpgradeCompleted) {
    // Differentiate the two ways a subscription is born:
    //   - `trialing` → fire `trial_started` (no revenue yet)
    //   - anything else → fire `upgrade_completed` (first revenue moment)
    const isTrial = sub.status === "trialing";
    await trackServer(
      isTrial ? "trial_started" : "upgrade_completed",
      {
        agencyId,
        plan,
        cadence: billingCadence,
        stripeSubscriptionId: sub.id,
        ...(isTrial && sub.trial_end
          ? { trialEndsAt: new Date(sub.trial_end * 1000).toISOString() }
          : {}),
      },
      { distinctId: `agency:${agencyId}`, agencyId },
    );
    // Day-0 email — event-driven, no cron. Recipients are the OWNER of the
    // agency (typically the person who signed up). Failure is swallowed so
    // the webhook still succeeds; Stripe would otherwise retry the event
    // and re-run the mutation.
    if (isTrial && sub.trial_end) {
      await sendTrialWelcomeForAgency(agencyId, {
        plan,
        trialEndsAt: new Date(sub.trial_end * 1000),
      });
    }
  } else if (trialUpdate.trialStatus === TrialStatus.CONVERTED) {
    // Fires exactly once per agency — the trialing → active transition can
    // only happen once. Marketing uses this to measure conversion rate.
    await trackServer(
      "trial_converted",
      {
        agencyId,
        plan,
        cadence: billingCadence,
        stripeSubscriptionId: sub.id,
      },
      { distinctId: `agency:${agencyId}`, agencyId },
    );
    // Day-15 conversion email — event-driven off the same transition as the
    // analytics event above.
    await sendTrialConvertedForAgency(agencyId, { plan });
  }
}

/**
 * Read the active Stripe Coupon attached to the subscription (if any) so
 * `/settings/billing` can surface "Special pricing — reverts to $X on Y"
 * to buyers on a custom-priced deal.
 *
 * `sub.discounts` is an array of Discount IDs (or expanded objects). The
 * subscription-webhook payloads Stripe delivers don't expand it, so a
 * second retrieve is needed to reach `discount.source.coupon.name` and
 * `discount.end`. That retrieve only fires when discounts are actually
 * present — the vast majority of subs pay zero extra Stripe calls.
 *
 * Returns nulls when there's no discount (which is also the clear-both-
 * columns signal for `syncSubscription`, so an expired coupon flips the
 * banner off automatically).
 */
async function resolveActiveDiscount(
  sub: Stripe.Subscription,
): Promise<{ label: string | null; endsAt: Date | null }> {
  if (!sub.discounts || sub.discounts.length === 0) {
    return { label: null, endsAt: null };
  }
  const stripe = requireStripeClient();
  const expanded = await stripe.subscriptions.retrieve(sub.id, {
    expand: ["discounts.source.coupon"],
  });
  const first = expanded.discounts?.[0];
  if (!first || typeof first === "string") return { label: null, endsAt: null };
  const coupon = first.source?.coupon;
  const label =
    coupon && typeof coupon !== "string"
      ? (coupon.name ?? coupon.id)
      : typeof coupon === "string"
        ? coupon
        : null;
  return {
    label,
    endsAt: first.end ? new Date(first.end * 1000) : null,
  };
}

/**
 * Loader + dispatcher for the day-0 welcome email. Kept as a helper so the
 * webhook's `syncSubscription` stays readable and so failures here can't
 * cascade into the mutation path.
 */
async function sendTrialWelcomeForAgency(
  agencyId: string,
  props: { plan: Plan; trialEndsAt: Date },
): Promise<void> {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: {
      name: true,
      members: {
        where: { role: "OWNER" },
        orderBy: { createdAt: "asc" },
        select: { email: true, name: true },
        take: 1,
      },
    },
  });
  const owner = agency?.members[0];
  if (!agency || !owner?.email) return;
  const firstName = (owner.name ?? owner.email).split(/[\s@]/)[0] ?? owner.email;
  await sendTrialWelcomeEmail(owner.email, {
    firstName,
    agencyName: agency.name,
    plan: props.plan,
    trialEndsAt: props.trialEndsAt,
  });
}

/**
 * Loader + dispatcher for the day-15 conversion email. Sent to every
 * OWNER/ADMIN so anyone with billing authority sees it.
 */
async function sendTrialConvertedForAgency(agencyId: string, props: { plan: Plan }): Promise<void> {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: {
      name: true,
      members: {
        where: { role: { in: ["OWNER", "ADMIN"] } },
        select: { email: true },
      },
    },
  });
  const recipients = (agency?.members ?? []).map((m) => m.email).filter(Boolean);
  if (!agency || recipients.length === 0) return;
  await sendTrialConvertedEmail(recipients, {
    agencyName: agency.name,
    plan: props.plan,
  });
}

/**
 * `customer.subscription.trial_will_end` fires ~3 days before
 * the trial ends (or immediately for trials shorter than 3 days). We use it
 * for the T-3 nudge email; Stripe drives the timing so we don't own a cron.
 */
async function handleTrialWillEnd(sub: Stripe.Subscription): Promise<void> {
  const agencyId = sub.metadata?.agencyId;
  if (!agencyId) return;

  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: {
      id: true,
      name: true,
      plan: true,
      trialEndsAt: true,
      trialStatus: true,
      members: {
        where: { role: { in: ["OWNER", "ADMIN"] } },
        select: { email: true, name: true },
      },
    },
  });
  if (!agency || agency.trialStatus !== TrialStatus.ACTIVE) return;

  const recipients = agency.members.map((m) => m.email).filter(Boolean);
  if (recipients.length === 0) return;

  await sendTrialEndingSoonEmail(recipients, {
    agencyName: agency.name,
    plan: agency.plan,
    trialEndsAt: agency.trialEndsAt ?? new Date(),
  });
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const agencyId = sub.metadata?.agencyId;
  if (!agencyId) return;
  // Differentiate trial teardown from paid churn. If the deleted
  // sub was still on trial, `sub.status === "trialing"` OR the agency's
  // stored trialStatus is ACTIVE — either signal is enough.
  const current = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { trialStatus: true },
  });
  const wasTrialing = sub.status === "trialing" || current?.trialStatus === TrialStatus.ACTIVE;
  const trialTerminal: TrialStatus | undefined = wasTrialing
    ? sub.cancellation_details?.reason === "cancellation_requested"
      ? TrialStatus.CANCELED
      : TrialStatus.EXPIRED
    : undefined;

  // Drop to SOLO on cancellation so users keep the lowest-tier limits;
  // null out the subscription id + any pending cancel-at marker (the sub
  // is fully gone, no "scheduled cancel" left to communicate). Cadence
  // resets to MONTHLY since there's no live sub to reference.
  await prisma.agency.update({
    where: { id: agencyId },
    data: {
      plan: "SOLO",
      billingCadence: "MONTHLY",
      stripeSubscriptionId: null,
      subscriptionCancelAt: null,
      ...(trialTerminal ? { trialStatus: trialTerminal } : {}),
    },
  });

  if (trialTerminal === TrialStatus.EXPIRED) {
    await trackServer(
      "trial_expired_no_conversion",
      { agencyId, stripeSubscriptionId: sub.id },
      { distinctId: `agency:${agencyId}`, agencyId },
    );
    // Send the "your trial ended without a charge" email. Skipped for the
    // CANCELED branch by design — cancellations are user-initiated and an
    // extra email at that moment reads as guilt-tripping.
    await sendTrialExpiredForAgency(agencyId);
  } else if (trialTerminal === TrialStatus.CANCELED) {
    await trackServer(
      "trial_canceled_early",
      { agencyId, stripeSubscriptionId: sub.id },
      { distinctId: `agency:${agencyId}`, agencyId },
    );
  }
}

async function sendTrialExpiredForAgency(agencyId: string): Promise<void> {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: {
      name: true,
      members: {
        where: { role: { in: ["OWNER", "ADMIN"] } },
        select: { email: true },
      },
    },
  });
  const recipients = (agency?.members ?? []).map((m) => m.email).filter(Boolean);
  if (!agency || recipients.length === 0) return;
  await sendTrialExpiredEmail(recipients, { agencyName: agency.name });
}

// ============================================================
// Checkout completion — Solo trial subscription creation
// ============================================================

/**
 * Second-half of the Solo trial signup. `checkoutFromOnboardingAction`
 * created a `mode: 'payment'` Checkout Session for the $1 activation
 * fee — that's how the user sees "$1 due today" in Stripe's UI and the
 * card gets saved via `payment_intent_data.setup_future_usage`. This
 * handler runs when that session completes and creates the actual
 * subscription (trialing, using the saved card).
 *
 * Non-trial paths (Studio, Network, returning-Solo without a fresh
 * trial) use `mode: 'subscription'` Checkout and don't need this
 * handler — Stripe creates the subscription itself on that path, and
 * `customer.subscription.created` fires directly.
 *
 * On Solo trial: the subscription-creation call below itself fires a
 * `customer.subscription.created` event with `status: trialing`, which
 * our existing `syncSubscription` handler then picks up to stamp
 * `Agency.trialStatus = ACTIVE`, `trialEndsAt`, etc. So this handler
 * only owns the Stripe write — the DB write happens downstream.
 *
 * Idempotency: Stripe retries `checkout.session.completed` on any
 * non-2xx. Our top-level `markWebhookProcessed` dedupe covers repeat
 * deliveries of the same event id. But if we ever re-trigger the same
 * session id manually, we need to avoid creating duplicate
 * subscriptions — hence the `stripeSubscriptionId` check on the agency
 * before touching Stripe.
 */
async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
  // Accept both the current `trial_activation` marker AND the legacy
  // `solo_trial_activation` name so in-flight Checkout sessions started
  // before the rename (when only Solo qualified) still finish cleanly.
  const isTrialActivation =
    session.metadata?.trial_activation === "true" ||
    session.metadata?.solo_trial_activation === "true";
  if (!isTrialActivation) return;
  // Only the mode:'payment' path needs the follow-up subscription create.
  // A mode:'subscription' session with this metadata means we accidentally
  // set the flag; skip so we don't double-create a subscription.
  if (session.mode !== "payment") return;

  const agencyId = session.metadata?.agencyId;
  const plan = session.metadata?.plan as Plan | undefined;
  const cadence = session.metadata?.cadence as BillingCadence | undefined;
  const currency = session.metadata?.currency;
  if (!agencyId || !plan || !cadence || !currency) {
    console.error("[stripe-webhook] Solo trial: missing metadata", {
      sessionId: session.id,
      metadata: session.metadata,
    });
    return;
  }

  const customerId =
    typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
  if (!customerId) {
    console.warn("[stripe-webhook] Solo trial: no customer on session", {
      sessionId: session.id,
    });
    return;
  }

  // Guard against double-creation. If our own agency row already has a
  // sub id (from a duplicate delivery that beat this call), skip. Also
  // stamps `stripeCustomerId` now so a re-attempt to trial from this
  // agency's account would fail the eligibility gate correctly.
  const agencyRow = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: { stripeSubscriptionId: true, stripeCustomerId: true },
  });
  if (agencyRow?.stripeSubscriptionId) {
    console.log("[stripe-webhook] Solo trial: subscription already created, skipping", {
      agencyId,
      sessionId: session.id,
    });
    return;
  }

  const stripe = requireStripeClient();

  // Pull the payment method off the completed PaymentIntent. The
  // Checkout Session set `setup_future_usage: 'off_session'`, which
  // attaches the PM to the customer as a reusable payment method — but
  // it doesn't set it as the customer's `invoice_settings.default_payment_method`.
  // We do that explicitly so Stripe uses this card for the recurring
  // charge on day 8 without any additional customer action.
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);
  if (!paymentIntentId) {
    console.error("[stripe-webhook] Solo trial: session has no payment_intent", {
      sessionId: session.id,
    });
    return;
  }

  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const paymentMethodId =
      typeof paymentIntent.payment_method === "string"
        ? paymentIntent.payment_method
        : (paymentIntent.payment_method?.id ?? null);
    if (!paymentMethodId) {
      console.error("[stripe-webhook] Solo trial: no payment method on PaymentIntent", {
        paymentIntentId,
      });
      return;
    }

    // Set the PM as the customer default so the recurring charge on
    // day 8 uses it without prompting.
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const planPriceId = session.metadata?.plan_price_id || priceIdFor(plan, cadence);
    if (!planPriceId) {
      console.error("[stripe-webhook] Solo trial: no plan price id available", { plan, cadence });
      return;
    }

    // Create the actual subscription. Stripe will fire
    // `customer.subscription.created` (status: trialing) which our
    // syncSubscription handler picks up to stamp Agency.trialStatus =
    // ACTIVE, trialEndsAt, stripeSubscriptionId. Payment attempt on
    // day 8 uses the default_payment_method we just set.
    const sub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: planPriceId }],
      trial_period_days: TRIAL_DAYS,
      default_payment_method: paymentMethodId,
      metadata: {
        agencyId,
        plan,
        cadence,
        currency,
        // Marker for downstream handlers so they know this sub came from
        // the Solo trial flow (vs a direct subscription Checkout).
        source: "solo_trial_activation",
      },
    });

    console.log("[stripe-webhook] Solo trial subscription created", {
      agencyId,
      customerId,
      subscriptionId: sub.id,
      trialEnd: sub.trial_end,
    });
  } catch (err) {
    // If subscription creation fails after we already charged the $1,
    // we're in a bad state — the user paid but has no trial. Log +
    // capture so ops can manually reconcile. We DON'T rethrow because
    // Stripe would retry the whole webhook, and by then the sub might
    // already exist from a prior attempt.
    console.error("[stripe-webhook] Solo trial subscription creation failed", {
      agencyId,
      customerId,
      sessionId: session.id,
      err,
    });
    captureWebhookFailure("stripe_webhook", err, {
      sessionId: session.id ?? "unknown",
      role: "solo_trial_subscription_create",
      agencyId,
    });
  }
}

// ============================================================
// Invoice handler
// ============================================================

const STRIPE_TO_INVOICE_STATUS: Record<string, InvoiceStatus> = {
  draft: InvoiceStatus.DRAFT,
  open: InvoiceStatus.OPEN,
  paid: InvoiceStatus.PAID,
  void: InvoiceStatus.VOID,
  uncollectible: InvoiceStatus.UNCOLLECTIBLE,
};

async function upsertInvoice(inv: Stripe.Invoice): Promise<void> {
  // The agency id lives on the subscription metadata; look it up if we don't
  // already have it on the Agency row.
  const customerId = typeof inv.customer === "string" ? inv.customer : (inv.customer?.id ?? null);
  if (!customerId) return;

  const agency = await prisma.agency.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });
  if (!agency) {
    console.warn("[stripe-webhook] no agency for customer", { customerId });
    return;
  }

  const status = STRIPE_TO_INVOICE_STATUS[inv.status ?? ""] ?? InvoiceStatus.OPEN;
  const periodStart = invoicePeriodStart(inv);
  const periodEnd = invoicePeriodEnd(inv);

  await prisma.invoice.upsert({
    where: { stripeInvoiceId: inv.id ?? "" },
    create: {
      agencyId: agency.id,
      stripeInvoiceId: inv.id ?? "",
      amountCents: inv.amount_due ?? 0,
      currency: inv.currency ?? "usd",
      status,
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      pdfUrl: inv.invoice_pdf ?? null,
      periodStart,
      periodEnd,
    },
    update: {
      amountCents: inv.amount_due ?? 0,
      status,
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      pdfUrl: inv.invoice_pdf ?? null,
    },
  });
}

function invoicePeriodStart(inv: Stripe.Invoice): Date {
  const ts = inv.lines.data[0]?.period?.start ?? inv.created ?? Math.floor(Date.now() / 1000);
  return new Date(ts * 1000);
}

function invoicePeriodEnd(inv: Stripe.Invoice): Date {
  const ts = inv.lines.data[0]?.period?.end ?? inv.created ?? Math.floor(Date.now() / 1000);
  return new Date(ts * 1000);
}
