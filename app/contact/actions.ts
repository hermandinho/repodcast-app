"use server";

import { headers } from "next/headers";
import { ZodError } from "zod";
import { CONTACT_EMAILS } from "@/lib/contact-emails";
import { getAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { isLiveDb } from "@/server/data/source";
import { createSupportTicket, type CreateSupportTicketInput } from "@/server/db/support-tickets";
import {
  sendSupportTicketAdminEmail,
  sendSupportTicketConfirmationEmail,
} from "@/server/email/send";
import { trackServer } from "@/server/analytics/track";
import { getClientIp, hashIp } from "@/server/security/ip";
import { verifyTurnstile } from "@/server/security/turnstile";

export type SubmitSupportTicketResult =
  { ok: true; refCode: string } | { ok: false; error: string };

/**
 * Public `/contact` support form. Anyone can call this — signed-in
 * submitters get their agency + member snapshotted on the row so ROOT
 * can drill in from the (deferred) `/root/support` queue.
 *
 * Order of operations is defensive:
 *   1. Turnstile verify — hard reject on failure, no DB, no email.
 *   2. Zod validation — surfaced as user-friendly errors.
 *   3. DB write — the durable source of truth.
 *   4. Emails — fire-and-forget; a Resend hiccup can't fail the ticket.
 *   5. Analytics — same fire-and-forget stance.
 */
export async function submitSupportTicketAction(
  input: CreateSupportTicketInput & { turnstileToken?: string },
): Promise<SubmitSupportTicketResult> {
  // Sample-data mode: don't hit Postgres. Return a synthetic ref code so
  // the UI can be exercised in the demo tenant.
  if (!isLiveDb()) {
    return { ok: true, refCode: "SUP-DEMO01" };
  }

  const ip = await getClientIp();

  const turnstile = await verifyTurnstile(input.turnstileToken, ip);
  if (!turnstile.ok) {
    return { ok: false, error: turnstile.error };
  }

  const auth = await getAuthContext().catch(() => null);
  const h = await headers();
  const userAgent = h.get("user-agent");

  try {
    const { turnstileToken: _turnstileToken, ...ticketInput } = input;
    void _turnstileToken;

    const created = await createSupportTicket(
      {
        agencyId: auth?.agency.id ?? null,
        memberId: auth?.member.id ?? null,
        userAgent: userAgent ?? null,
        ipHash: hashIp(ip),
      },
      ticketInput,
    );

    // Best-effort mirrors — the durable row already landed.
    void sendSupportTicketAdminEmail(CONTACT_EMAILS.support, {
      category: ticketInput.category,
      refCode: created.refCode,
      subject: ticketInput.subject,
      body: ticketInput.body,
      submitterName: ticketInput.name,
      submitterEmail: ticketInput.email,
      agencyName: auth?.agency.name ?? null,
      contextUrl: ticketInput.contextUrl ?? null,
    }).catch((err) => {
      console.error("[support-ticket] admin notification failed", {
        id: created.id,
        err,
      });
    });

    void sendSupportTicketConfirmationEmail(ticketInput.email, {
      submitterName: ticketInput.name,
      refCode: created.refCode,
      subject: ticketInput.subject,
      supportEmail: CONTACT_EMAILS.support,
    }).catch((err) => {
      console.error("[support-ticket] confirmation email failed", {
        id: created.id,
        err,
      });
    });

    void trackServer(
      "support_ticket_submitted",
      {
        ticketId: created.id,
        refCode: created.refCode,
        category: ticketInput.category,
        fromSignedInUser: !!auth,
      },
      {
        distinctId: auth?.user.clerkUserId ?? `anon:${created.id}`,
        agencyId: auth?.agency.id,
      },
    ).catch(() => {
      // trackServer already swallows internally, but the return type is
      // Promise<void> — guard the .catch for the linter.
    });

    return { ok: true, refCode: created.refCode };
  } catch (err) {
    if (err instanceof ZodError) {
      return { ok: false, error: err.issues[0]?.message ?? "Invalid input" };
    }
    if (err instanceof ValidationError) {
      return { ok: false, error: err.message };
    }
    console.error("[support-ticket] submit failed", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
