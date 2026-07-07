"use server";

import { ZodError } from "zod";
import { getAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { isLiveDb } from "@/server/data/source";
import { createSuggestion, type CreateSuggestionInput } from "@/server/db/suggestions";
import { sendSuggestionReceivedEmail } from "@/server/email/send";
import { CONTACT_EMAILS } from "@/lib/contact-emails";

export type SubmitSuggestionResult = { ok: true } | { ok: false; error: string };

/**
 * Called from the dashboard's floating Feedback button. The write is the
 * durable source of truth — email is fire-and-forget so a Resend hiccup
 * never fails the submission.
 *
 * Reporter identity is snapshotted at submit time so the queue on
 * `/root/feedback` still reads correctly if the member is later removed
 * from the agency.
 */
export async function submitSuggestionAction(
  input: CreateSuggestionInput,
): Promise<SubmitSuggestionResult> {
  if (!isLiveDb()) {
    // Sample-data mode — pretend the submission succeeded so the UI can
    // still be exercised in the demo tenant without touching Postgres.
    return { ok: true };
  }

  const auth = await getAuthContext();
  if (!auth) {
    return { ok: false, error: "You need to be signed in to send feedback." };
  }

  try {
    const created = await createSuggestion(
      {
        agencyId: auth.agency.id,
        memberId: auth.member.id,
        reporterEmail: auth.user.email,
        reporterName: auth.user.name,
      },
      input,
    );

    // Best-effort mirror to the feedback inbox. Errors are swallowed —
    // the durable row already landed.
    void sendSuggestionReceivedEmail(CONTACT_EMAILS.feedback, {
      type: input.type,
      title: input.title,
      body: input.body,
      reporterName: auth.user.name,
      reporterEmail: auth.user.email,
      agencyName: auth.agency.name,
      contextUrl: input.contextUrl ?? null,
    }).catch((err) => {
      console.error("[suggestion] email notification failed", { id: created.id, err });
    });

    return { ok: true };
  } catch (err) {
    if (err instanceof ZodError) {
      return { ok: false, error: err.issues[0]?.message ?? "Invalid input" };
    }
    if (err instanceof ValidationError) {
      return { ok: false, error: err.message };
    }
    console.error("[suggestion] submit failed", err);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
