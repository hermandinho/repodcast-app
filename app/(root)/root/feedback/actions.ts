"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth/errors";
import { requireSystemAdminContext } from "@/server/auth/system";
import { updateSuggestionStatus } from "@/server/db/system/suggestions";

/**
 * Server actions behind `/root/feedback`. Same shape as `/root/quality`:
 * gate via `requireSystemAdminContext`, delegate the mutation + audit to
 * the repo helper, bounce back with `?error=<code>` on failure so the
 * banner surface can render a message.
 */

export async function updateSuggestionStatusAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();

  const status = strOrEmpty(formData.get("status"));
  if (
    status !== "NEW" &&
    status !== "TRIAGED" &&
    status !== "PLANNED" &&
    status !== "IN_PROGRESS" &&
    status !== "SHIPPED" &&
    status !== "WONTFIX"
  ) {
    redirect("/root/feedback?error=invalid_status");
  }

  try {
    await updateSuggestionStatus(ctx, {
      id: strOrEmpty(formData.get("id")),
      status,
      resolution: strOrUndef(formData.get("resolution")),
      note: strOrUndef(formData.get("note")),
    });
  } catch (err) {
    redirect(`/root/feedback?error=${errCode(err)}`);
  }
  revalidatePath("/root/feedback");
  redirect("/root/feedback?ok=updated");
}

// ============================================================
// Helpers
// ============================================================

function strOrEmpty(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v : "";
}

function strOrUndef(v: FormDataEntryValue | null): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function errCode(err: unknown): string {
  if (err instanceof ZodError) return "invalid";
  if (err instanceof ValidationError) return "invalid";
  if (err instanceof NotFoundError) return "not_found";
  if (err instanceof ForbiddenError) return "forbidden";
  return "unknown";
}
