import { type BillingCadence, InvoiceStatus, type Plan } from "@prisma/client";
import { headers } from "next/headers";
import { trackServer } from "@/server/analytics/track";
import { planAndCadenceForPriceId } from "@/server/billing/prices";
import { Stripe, requireStripeClient } from "@/server/billing/stripe";
import { prisma } from "@/server/db/client";
import { markWebhookProcessed, unmarkWebhookProcessed } from "@/server/db/webhook-deliveries";
import { captureWebhookFailure } from "@/server/observability/sentry";

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

  await prisma.agency.update({
    where: { id: agencyId },
    data: {
      plan,
      billingCadence,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
    },
  });

  // Phase 3.7 — upgrade funnel completion. Only fires on
  // `customer.subscription.created` (not on updates) so the funnel
  // metric doesn't double-count every subscription mutation. The
  // webhook is the authoritative signal: client redirects lie
  // (users close the tab, Stripe retries, etc.).
  if (fireUpgradeCompleted) {
    await trackServer(
      "upgrade_completed",
      {
        agencyId,
        plan,
        cadence: billingCadence,
        stripeSubscriptionId: sub.id,
      },
      { distinctId: `agency:${agencyId}`, agencyId },
    );
  }
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const agencyId = sub.metadata?.agencyId;
  if (!agencyId) return;
  // Drop to STUDIO on cancellation so users keep the lowest-tier limits;
  // null out the subscription id. Cadence resets to MONTHLY since there's
  // no live sub to reference.
  await prisma.agency.update({
    where: { id: agencyId },
    data: {
      plan: "STUDIO",
      billingCadence: "MONTHLY",
      stripeSubscriptionId: null,
    },
  });
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
