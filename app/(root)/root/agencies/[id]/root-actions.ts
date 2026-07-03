"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import type { Plan } from "@prisma/client";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth/errors";
import { requireSystemAdminContext } from "@/server/auth/system";
import {
  extendAgencyTrial,
  forceCancelAgencySubscription,
  grantAgencyPlanOverride,
  hardDeleteAgency,
  recordInvoiceRefundIntent,
  revokeAgencyPlanOverride,
  suspendAgency,
  unsuspendAgency,
} from "@/server/db/system/agencies";

/**
 * Phase 3.6.5 — server actions behind `/root/agencies/[id]`.
 *
 * Every action follows the same shape as the other /root actions:
 *   1. `requireSystemAdminContext` gates the ROUTE (invisible 404 for non-admins).
 *   2. Repo helper enforces `SYSTEM_WRITE_ROLES` + wraps in `withSystemAudit`.
 *   3. On thrown error → redirect back to the drilldown with `?action_error=<code>`.
 *   4. On success → `revalidatePath` + redirect with `?action_ok=<verb>`.
 */

// ============================================================
// Suspend / unsuspend
// ============================================================

export async function suspendAgencyAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();
  const id = strOrEmpty(formData.get("id"));

  try {
    await suspendAgency(ctx, { id, note: strOrEmpty(formData.get("note")) });
  } catch (err) {
    redirect(`/root/agencies/${id}?action_error=${errCode(err)}`);
  }
  revalidatePath(`/root/agencies/${id}`);
  redirect(`/root/agencies/${id}?action_ok=suspended`);
}

export async function unsuspendAgencyAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();
  const id = strOrEmpty(formData.get("id"));

  try {
    await unsuspendAgency(ctx, { id, note: strOrEmpty(formData.get("note")) });
  } catch (err) {
    redirect(`/root/agencies/${id}?action_error=${errCode(err)}`);
  }
  revalidatePath(`/root/agencies/${id}`);
  redirect(`/root/agencies/${id}?action_ok=unsuspended`);
}

// ============================================================
// Plan override
// ============================================================

export async function grantAgencyPlanOverrideAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();
  const id = strOrEmpty(formData.get("id"));
  const rawPlan = strOrEmpty(formData.get("plan"));

  if (rawPlan !== "STUDIO" && rawPlan !== "AGENCY" && rawPlan !== "NETWORK") {
    redirect(`/root/agencies/${id}?action_error=invalid_plan`);
  }

  try {
    await grantAgencyPlanOverride(ctx, {
      id,
      plan: rawPlan as Plan,
      note: strOrEmpty(formData.get("note")),
    });
  } catch (err) {
    redirect(`/root/agencies/${id}?action_error=${errCode(err)}`);
  }
  revalidatePath(`/root/agencies/${id}`);
  redirect(`/root/agencies/${id}?action_ok=override_granted`);
}

export async function revokeAgencyPlanOverrideAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();
  const id = strOrEmpty(formData.get("id"));

  try {
    await revokeAgencyPlanOverride(ctx, { id, note: strOrEmpty(formData.get("note")) });
  } catch (err) {
    redirect(`/root/agencies/${id}?action_error=${errCode(err)}`);
  }
  revalidatePath(`/root/agencies/${id}`);
  redirect(`/root/agencies/${id}?action_ok=override_revoked`);
}

// ============================================================
// Force-cancel subscription
// ============================================================

export async function forceCancelAgencySubscriptionAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();
  const id = strOrEmpty(formData.get("id"));
  const confirmName = strOrEmpty(formData.get("confirmName"));
  const expectedName = strOrEmpty(formData.get("expectedName"));

  // Type-name-to-confirm gate. The expected name is round-tripped through a
  // hidden field so an operator can't skip the confirmation by editing DOM
  // (the server compares to what the page rendered).
  if (confirmName.trim() !== expectedName.trim() || confirmName.length === 0) {
    redirect(`/root/agencies/${id}?action_error=confirm_mismatch`);
  }

  try {
    await forceCancelAgencySubscription(ctx, {
      id,
      note: strOrEmpty(formData.get("note")),
    });
  } catch (err) {
    redirect(`/root/agencies/${id}?action_error=${errCode(err)}`);
  }
  revalidatePath(`/root/agencies/${id}`);
  redirect(`/root/agencies/${id}?action_ok=subscription_canceled`);
}

// ============================================================
// Hard-delete (ROOT-only, irreversible)
// ============================================================

export async function hardDeleteAgencyAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();
  const id = strOrEmpty(formData.get("id"));
  const confirmName = strOrEmpty(formData.get("confirmName"));
  const expectedName = strOrEmpty(formData.get("expectedName"));

  // Two-key confirm: the operator must type the agency name, AND that
  // typed name must match what the page rendered (protects against a
  // stale form that pre-fills a name after a rename mid-tab).
  if (confirmName.trim() !== expectedName.trim() || confirmName.length === 0) {
    redirect(`/root/agencies/${id}?action_error=confirm_mismatch`);
  }

  try {
    await hardDeleteAgency(ctx, {
      id,
      confirmName,
      note: strOrEmpty(formData.get("note")),
    });
  } catch (err) {
    redirect(`/root/agencies/${id}?action_error=${errCode(err)}`);
  }
  // The agency row is gone — redirect to the list surface with a success
  // banner. The old drilldown URL now 404s.
  redirect(`/root/agencies?deleted=${encodeURIComponent(expectedName)}`);
}

// ============================================================
// Extend trial (Phase 3.9)
// ============================================================

export async function extendAgencyTrialAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();
  const id = strOrEmpty(formData.get("id"));

  try {
    await extendAgencyTrial(ctx, {
      id,
      additionalDays: Number.parseInt(strOrEmpty(formData.get("additionalDays")), 10),
      note: strOrEmpty(formData.get("note")),
    });
  } catch (err) {
    redirect(`/root/agencies/${id}?action_error=${errCode(err)}`);
  }
  revalidatePath(`/root/agencies/${id}`);
  redirect(`/root/agencies/${id}?action_ok=trial_extended`);
}

// ============================================================
// Refund intent (audit-only, then hop to Stripe)
// ============================================================

export async function recordInvoiceRefundIntentAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();
  const agencyId = strOrEmpty(formData.get("agencyId"));
  const invoiceId = strOrEmpty(formData.get("invoiceId"));

  let stripeUrl: string;
  try {
    const result = await recordInvoiceRefundIntent(ctx, {
      invoiceId,
      note: strOrEmpty(formData.get("note")),
    });
    stripeUrl = result.stripeUrl;
  } catch (err) {
    redirect(`/root/agencies/${agencyId}?action_error=${errCode(err)}`);
  }
  revalidatePath(`/root/agencies/${agencyId}`);
  // Next's `redirect()` accepts an absolute URL and issues a 302 — the
  // operator lands on the Stripe dashboard with the audit row already
  // stamped.
  redirect(stripeUrl);
}

// ============================================================
// Helpers
// ============================================================

function strOrEmpty(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v : "";
}

function errCode(err: unknown): string {
  if (err instanceof ZodError) return "invalid";
  if (err instanceof ValidationError) return "invalid";
  if (err instanceof NotFoundError) return "not_found";
  if (err instanceof ForbiddenError) return "forbidden";
  return "unknown";
}
