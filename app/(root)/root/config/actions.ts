"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth/errors";
import { requireSystemAdminContext } from "@/server/auth/system";
import {
  deleteSystemConfig,
  revokeAgencyLimitOverride,
  upsertAgencyLimitOverride,
  upsertSystemConfig,
} from "@/server/db/system/config";
import { findKnownConfig } from "@/lib/system-config-catalog";

/**
 * Phase 3.6.11 — server actions behind `/root/config`.
 *
 * Each action follows the same shape:
 *   1. `requireSystemAdminContext()` — 404s the ROUTE surface on non-admins.
 *   2. Delegate to the repo helper, which enforces the role gate
 *      (`SYSTEM_WRITE_ROLES`) + wraps the mutation in `withSystemAudit`.
 *   3. On thrown error → redirect back to `/root/config?error=<code>` so the
 *      page can surface a toast without exposing the underlying message.
 *   4. On success → `revalidatePath` + redirect with `?ok=1` for the same
 *      toast surface.
 *
 * Every mutation lands a `SystemAuditLog` row inside the same $transaction
 * as the write. There is no "changed but didn't log" path.
 */

// ============================================================
// SystemConfig
// ============================================================

export async function upsertSystemConfigAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();
  const key = strOrEmpty(formData.get("key"));

  try {
    await upsertSystemConfig(ctx, {
      key,
      valueJson: strOrEmpty(formData.get("valueJson")),
      description: strOrUndef(formData.get("description")),
      note: strOrUndef(formData.get("note")),
    });
  } catch (err) {
    redirect(`/root/config?error=${errCode(err)}&key=${encodeURIComponent(key)}`);
  }
  revalidatePath("/root/config");
  revalidateDependentPaths(key);
  redirect(`/root/config?ok=1&key=${encodeURIComponent(key)}`);
}

export async function deleteSystemConfigAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();
  const key = strOrEmpty(formData.get("key"));

  try {
    await deleteSystemConfig(ctx, {
      key,
      note: strOrEmpty(formData.get("note")),
    });
  } catch (err) {
    redirect(`/root/config?error=${errCode(err)}&key=${encodeURIComponent(key)}`);
  }
  revalidatePath("/root/config");
  revalidateDependentPaths(key);
  redirect("/root/config?ok=deleted");
}

/**
 * Invalidate every page listed on the catalog entry for this key. Without
 * this, a `LANDING_TRUSTED_BY` write updates the DB row but the marketing
 * page keeps serving the cached hero — the whole point of the "edit without
 * redeploy" flow is that operators see the change immediately.
 */
function revalidateDependentPaths(key: string): void {
  const entry = findKnownConfig(key);
  if (!entry?.revalidatePaths) return;
  for (const path of entry.revalidatePaths) {
    revalidatePath(path);
  }
}

// ============================================================
// AgencyLimitOverride
// ============================================================

export async function upsertAgencyLimitOverrideAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();

  const agencyId = strOrEmpty(formData.get("agencyId"));
  const resource = strOrEmpty(formData.get("resource"));
  const rawValue = strOrEmpty(formData.get("value"));
  const rawExpires = strOrUndef(formData.get("expiresAt"));
  const note = strOrUndef(formData.get("note"));

  if (
    resource !== "SHOWS" &&
    resource !== "MEMBERS" &&
    resource !== "EPISODES" &&
    resource !== "GENERATIONS"
  ) {
    redirect(`/root/config?error=invalid_resource`);
  }

  try {
    await upsertAgencyLimitOverride(ctx, {
      agencyId,
      resource,
      value: Number.parseInt(rawValue, 10),
      expiresAt: rawExpires ? new Date(rawExpires) : undefined,
      note,
    });
  } catch (err) {
    redirect(`/root/config?error=${errCode(err)}`);
  }
  revalidatePath("/root/config");
  redirect(`/root/config?ok=override&agencyId=${encodeURIComponent(agencyId)}`);
}

export async function revokeAgencyLimitOverrideAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();
  const id = strOrEmpty(formData.get("id"));

  try {
    await revokeAgencyLimitOverride(ctx, {
      id,
      note: strOrEmpty(formData.get("note")),
    });
  } catch (err) {
    redirect(`/root/config?error=${errCode(err)}`);
  }
  revalidatePath("/root/config");
  redirect("/root/config?ok=revoked");
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
