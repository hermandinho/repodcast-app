"use server";

import { revalidatePath } from "next/cache";
import { submitPortalFeedback, type SubmitPortalFeedbackResult } from "@/server/db/client-portal";

/**
 * Server action bound to the `<PortalFeedbackForm>` on `/portal/[token]`.
 *
 * The `useFormState` / `useTransition` client uses this action to send
 * feedback without exposing the underlying DB helper. We pass through the
 * discriminated `SubmitPortalFeedbackResult` so the form can render
 * throttling and invalid-token cases distinctly from success.
 *
 * `revalidatePath` is scoped to the same token path — a successful
 * submission doesn't need to refetch (the form clears itself), but any
 * agency-side surface reading the feedback count via the client billing
 * page will pick up the new row on its next render.
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
