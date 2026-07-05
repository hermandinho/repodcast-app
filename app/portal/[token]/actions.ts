"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  getPortalLinkByToken,
  submitPortalApproval,
  submitPortalFeedback,
  submitPortalRevisionRequest,
  verifyPortalPassword,
  type PortalApprovalResult,
  type SubmitPortalFeedbackResult,
} from "@/server/db/client-portal";

/**
 * Server actions bound to the `/portal/[token]` client components.
 *
 * The `useFormState` / `useTransition` clients call these to send feedback,
 * approve outputs, or request revisions without exposing the underlying DB
 * helpers. Each action returns a discriminated result so the UI can render
 * throttling and invalid-token cases distinctly from success.
 *
 * `revalidatePath` on success ensures the deliverables list reflects the
 * new state (e.g. an approved output moves out of the "Pending your
 * approval" section on the next render).
 */

export async function submitPortalFeedbackAction(input: {
  token: string;
  outputId?: string;
  body: string;
  fromEmail?: string;
}): Promise<SubmitPortalFeedbackResult> {
  const result = await submitPortalFeedback(input);
  if (result.ok) {
    revalidatePath(`/portal/${input.token}`);
  }
  return result;
}

export async function submitPortalApprovalAction(input: {
  token: string;
  outputId: string;
  fromEmail?: string;
}): Promise<PortalApprovalResult> {
  const result = await submitPortalApproval(input);
  if (result.ok) {
    revalidatePath(`/portal/${input.token}`);
  }
  return result;
}

export async function submitPortalRevisionRequestAction(input: {
  token: string;
  outputId: string;
  fromEmail?: string;
  note?: string;
}): Promise<PortalApprovalResult> {
  const result = await submitPortalRevisionRequest(input);
  if (result.ok) {
    revalidatePath(`/portal/${input.token}`);
  }
  return result;
}

/**
 * Password gate for password-protected portal links. Verifies the
 * submitted password against the stored one and, on match, sets a
 * per-link HttpOnly cookie so subsequent requests skip the form. The
 * cookie's Max-Age is capped at the link's remaining lifetime so a
 * cached credential can't outlive its link.
 *
 * Path-scoped to the specific portal URL — `/portal/${token}` — so the
 * cookie never leaks across links minted for other clients on the same
 * agency. Returns `invalid_token` for missing/revoked/expired links so
 * the client-side form can prompt for a fresh URL.
 */
export type SubmitPortalPasswordResult =
  { ok: true } | { ok: false; reason: "invalid_token" | "no_password" | "wrong_password" };

export async function submitPortalPasswordAction(input: {
  token: string;
  password: string;
}): Promise<SubmitPortalPasswordResult> {
  const link = await getPortalLinkByToken(input.token);
  if (!link) return { ok: false, reason: "invalid_token" };
  if (!link.password) return { ok: false, reason: "no_password" };
  if (!verifyPortalPassword(link.password, input.password)) {
    return { ok: false, reason: "wrong_password" };
  }
  const store = await cookies();
  const remainingMs = link.expiresAt.getTime() - Date.now();
  const maxAge = Math.max(60, Math.floor(remainingMs / 1000));
  // Cookie value IS the plaintext password. The gate compares this
  // cookie's value against the stored password on every render — same
  // check the form does — so a stolen cookie is functionally
  // equivalent to knowing the password itself, which is the intended
  // "you get in with the shared secret" model.
  store.set(`portal_pwd_${input.token}`, input.password, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: `/portal/${input.token}`,
    maxAge,
  });
  return { ok: true };
}
