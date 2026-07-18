"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth/errors";
import { requireSystemAdminContext } from "@/server/auth/system";
import { updateSupportTicketStatus } from "@/server/db/system/support-tickets";

/**
 * Server actions behind `/root/support`. Same shape as `/root/feedback`:
 * gate via `requireSystemAdminContext`, delegate the mutation + audit to
 * the repo helper, bounce back with `?error=<code>` on failure so the
 * banner surface can render a message.
 */

export async function updateSupportTicketStatusAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();

  const status = strOrEmpty(formData.get("status"));
  if (
    status !== "NEW" &&
    status !== "OPEN" &&
    status !== "WAITING_ON_USER" &&
    status !== "RESOLVED" &&
    status !== "CLOSED"
  ) {
    redirect("/root/support?error=invalid_status");
  }

  try {
    await updateSupportTicketStatus(ctx, {
      id: strOrEmpty(formData.get("id")),
      status,
      resolution: strOrUndef(formData.get("resolution")),
      note: strOrUndef(formData.get("note")),
    });
  } catch (err) {
    redirect(`/root/support?error=${errCode(err)}`);
  }
  revalidatePath("/root/support");
  redirect("/root/support?ok=updated");
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
