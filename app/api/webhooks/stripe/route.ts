import { type BillingCadence, InvoiceStatus, type Plan, TrialStatus } from "@prisma/client";
import { headers } from "next/headers";
import { trackServer } from "@/server/analytics/track";
import { planAndCadenceForPriceId } from "@/server/billing/prices";
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
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set");
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
    console.warn("[stripe-webhook] signature verification failed", err);
    return new Response("invalid signature", { status: 400 });
  }

  // Idempotency: claim this event's id in the dedupe ledger *before*
  // dispatching. Stripe retries on non-2xx, so the same `event.id` can
  // arrive multiple times — without this we'd double-apply plan changes,
  // resync invoices repeatedly, and rack up redundant writes. Concurrent
  // deliveries collapse on the unique constraint; the loser short-circuits.
  const claim = await markWebhookProcessed("stripe", event.id, event.type);
  if (claim.deduped) {
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

  // Phase 3.9 — trial state. Read the current row so we can detect the
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

  await prisma.agency.update({
    where: { id: agencyId },
    data: {
      plan,
      billingCadence,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      ...trialUpdate,
    },
  });

  // Phase 3.7 — upgrade funnel completion. Only fires on
  // `customer.subscription.created` (not on updates) so the funnel
  // metric doesn't double-count every subscription mutation. The
  // webhook is the authoritative signal: client redirects lie
  // (users close the tab, Stripe retries, etc.).
  if (fireUpgradeCompleted) {
    // Phase 3.9 — differentiate the two ways a subscription is born:
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
 * Phase 3.9 — `customer.subscription.trial_will_end` fires ~3 days before
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
  // Phase 3.9 — differentiate trial teardown from paid churn. If the deleted
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

  // Drop to STUDIO on cancellation so users keep the lowest-tier limits;
  // null out the subscription id. Cadence resets to MONTHLY since there's
  // no live sub to reference.
  await prisma.agency.update({
    where: { id: agencyId },
    data: {
      plan: "STUDIO",
      billingCadence: "MONTHLY",
      stripeSubscriptionId: null,
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
