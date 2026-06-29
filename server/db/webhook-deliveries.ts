import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "./client";

/**
 * Dedupe ledger for provider webhooks (Stripe today; designed for Clerk +
 * Resend later). Pattern from the handler's perspective:
 *
 *   const { deduped } = await markWebhookProcessed(source, eventId, eventType);
 *   if (deduped) return 204; // Stripe retry of an event we've already handled
 *   try {
 *     await dispatch(event);
 *   } catch (err) {
 *     // Roll back the ledger row so the provider's next retry re-processes.
 *     await unmarkWebhookProcessed(source, eventId);
 *     throw err;
 *   }
 */
export type WebhookSource = "stripe" | "clerk" | "resend";

export type MarkResult = { deduped: boolean };

/**
 * Atomically claim an inbound event. The unique `(source, eventId)`
 * constraint collapses concurrent inserts into one winner — Prisma surfaces
 * the loser as `P2002`, which we translate to `{ deduped: true }`.
 */
export async function markWebhookProcessed(
  source: WebhookSource,
  eventId: string,
  eventType: string,
): Promise<MarkResult> {
  try {
    await prisma.webhookDelivery.create({
      data: { source, eventId, eventType },
    });
    return { deduped: false };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { deduped: true };
    }
    throw err;
  }
}

/**
 * Reverse `markWebhookProcessed` when dispatch fails so the provider's
 * retry can re-process. Tolerant of a missing row — a successful undo and
 * a "row was never there" both end in the same state (no ledger row), and
 * we don't want this cleanup path to throw and mask the real dispatch error.
 */
export async function unmarkWebhookProcessed(
  source: WebhookSource,
  eventId: string,
): Promise<void> {
  await prisma.webhookDelivery.deleteMany({
    where: { source, eventId },
  });
}
