"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuthContext } from "@/server/auth/context";
import { NotFoundError, ValidationError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import { isLiveDb } from "@/server/data/source";
import { markPortalFeedbackRead, markPortalFeedbackUnread } from "@/server/db/client-portal";

/**
 * Phase 3.8 — agency-side triage actions for `ClientPortalFeedback`.
 *
 * Both actions are OWNER / ADMIN / EDITOR / REVIEWER — same read-tier as
 * viewing the feedback list. The DB helpers enforce the tenant filter and
 * throw `NotFoundError` on a cross-tenant id, which we translate to a
 * user-facing "not found" for the settings UI.
 *
 * `clientId` is passed through purely so the action can revalidate the
 * correct client billing route on success.
 */

const feedbackTriageInput = z.object({
  feedbackId: z.string().min(1),
  clientId: z.string().min(1),
});

export type FeedbackTriageResult = { ok: true } | { ok: false; error: string };

export async function markPortalFeedbackReadAction(raw: unknown): Promise<FeedbackTriageResult> {
  const parsed = feedbackTriageInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid feedback-triage input", parsed.error.issues);
  }
  if (!isLiveDb()) return { ok: true };

  const auth = await requireAuthContext();
  try {
    await markPortalFeedbackRead(toTenantContext(auth), parsed.data.feedbackId, auth.member.id);
  } catch (err) {
    if (err instanceof NotFoundError) return { ok: false, error: "Feedback not found." };
    throw err;
  }
  revalidatePath(`/clients/${parsed.data.clientId}/billing`);
  return { ok: true };
}

export async function markPortalFeedbackUnreadAction(raw: unknown): Promise<FeedbackTriageResult> {
  const parsed = feedbackTriageInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid feedback-triage input", parsed.error.issues);
  }
  if (!isLiveDb()) return { ok: true };

  const auth = await requireAuthContext();
  try {
    await markPortalFeedbackUnread(toTenantContext(auth), parsed.data.feedbackId);
  } catch (err) {
    if (err instanceof NotFoundError) return { ok: false, error: "Feedback not found." };
    throw err;
  }
  revalidatePath(`/clients/${parsed.data.clientId}/billing`);
  return { ok: true };
}
