"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth/errors";
import { requireSystemAdminContext } from "@/server/auth/system";
import {
  assignAbuseReport,
  createAbuseReport,
  dismissAbuseReport,
  flagOutput,
  resolveAbuseReport,
  unflagOutput,
} from "@/server/db/system/quality";

/**
 * Server actions behind `/root/quality`.
 *
 * Same shape as `/root/config/actions.ts`: `requireSystemAdminContext` gates
 * the surface, the repo helper enforces the write-role gate + wraps every
 * mutation in `withSystemAudit`, thrown errors bounce back to the page with
 * an `?error=<code>` query so the toast surface can render a message.
 */

// ============================================================
// Abuse reports
// ============================================================

export async function createAbuseReportAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();

  const category = strOrEmpty(formData.get("category"));
  if (
    category !== "SPAM" &&
    category !== "COPYRIGHT" &&
    category !== "IMPERSONATION" &&
    category !== "HARASSMENT" &&
    category !== "OTHER"
  ) {
    redirect("/root/quality?error=invalid_category");
  }

  try {
    await createAbuseReport(ctx, {
      reportedByEmail: strOrUndef(formData.get("reportedByEmail")),
      category,
      body: strOrEmpty(formData.get("body")),
      targetAgencyId: strOrUndef(formData.get("targetAgencyId")),
      targetMemberId: strOrUndef(formData.get("targetMemberId")),
      targetOutputId: strOrUndef(formData.get("targetOutputId")),
      assignedToSystemAdminId: strOrUndef(formData.get("assignedToSystemAdminId")),
      note: strOrUndef(formData.get("note")),
    });
  } catch (err) {
    redirect(`/root/quality?error=${errCode(err)}`);
  }
  revalidatePath("/root/quality");
  redirect("/root/quality?ok=created");
}

export async function assignAbuseReportAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();
  const id = strOrEmpty(formData.get("id"));
  const rawAssignee = strOrUndef(formData.get("assignedToSystemAdminId"));

  try {
    await assignAbuseReport(ctx, {
      id,
      assignedToSystemAdminId: rawAssignee ?? null,
      note: strOrUndef(formData.get("note")),
    });
  } catch (err) {
    redirect(`/root/quality?error=${errCode(err)}`);
  }
  revalidatePath("/root/quality");
  redirect("/root/quality?ok=assigned");
}

export async function resolveAbuseReportAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();

  try {
    await resolveAbuseReport(ctx, {
      id: strOrEmpty(formData.get("id")),
      resolution: strOrEmpty(formData.get("resolution")),
      note: strOrUndef(formData.get("note")),
    });
  } catch (err) {
    redirect(`/root/quality?error=${errCode(err)}`);
  }
  revalidatePath("/root/quality");
  redirect("/root/quality?ok=resolved");
}

export async function dismissAbuseReportAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();

  try {
    await dismissAbuseReport(ctx, {
      id: strOrEmpty(formData.get("id")),
      note: strOrEmpty(formData.get("note")),
    });
  } catch (err) {
    redirect(`/root/quality?error=${errCode(err)}`);
  }
  revalidatePath("/root/quality");
  redirect("/root/quality?ok=dismissed");
}

// ============================================================
// Flagged outputs
// ============================================================

export async function flagOutputAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();

  try {
    await flagOutput(ctx, {
      outputId: strOrEmpty(formData.get("outputId")),
      reason: strOrEmpty(formData.get("reason")),
    });
  } catch (err) {
    redirect(`/root/quality?error=${errCode(err)}`);
  }
  revalidatePath("/root/quality");
  redirect("/root/quality?ok=flagged");
}

export async function unflagOutputAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();

  try {
    await unflagOutput(ctx, {
      outputId: strOrEmpty(formData.get("outputId")),
      note: strOrEmpty(formData.get("note")),
    });
  } catch (err) {
    redirect(`/root/quality?error=${errCode(err)}`);
  }
  revalidatePath("/root/quality");
  redirect("/root/quality?ok=unflagged");
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
