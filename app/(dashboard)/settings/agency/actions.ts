"use server";

import { revalidatePath } from "next/cache";
import { ValidationError } from "@/server/auth/errors";
import {
  updateAgency as repoUpdateAgency,
  updateAgencyInput,
  updateRenewalReminders as repoUpdateRenewalReminders,
  updateRenewalRemindersInput,
} from "@/server/db/agencies";
import { isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Rename the active agency. The agency name surfaces on the topbar, the
 * dashboard greeting, and welcome/invite emails — revalidate every layout
 * that reads it so the next render reflects the change without a manual
 * refresh.
 */
export async function updateAgencyAction(raw: unknown): Promise<ActionResult<{ name: string }>> {
  const parsed = updateAgencyInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid agency update", parsed.error.issues);
  }

  if (!isLiveDb()) {
    // Sample-data mode: the demo tenant is read-only. Return success so the
    // form transitions cleanly on a fresh clone, but skip the write.
    return { ok: true, data: { name: parsed.data.name } };
  }

  const tenant = await resolveTenantContext();
  try {
    const agency = await repoUpdateAgency(tenant, parsed.data);
    // Topbar + dashboard greeting read the agency name; the (dashboard)
    // layout owns both.
    revalidatePath("/(dashboard)", "layout");
    revalidatePath("/settings/agency");
    return { ok: true, data: { name: agency.name } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't update agency.",
    };
  }
}

/**
 * Phase 2.13.6 — flip the renewals-reminder cron's mute switch. Same
 * OWNER/ADMIN role gate as the rename action.
 */
export async function updateRenewalRemindersAction(
  raw: unknown,
): Promise<ActionResult<{ enabled: boolean }>> {
  const parsed = updateRenewalRemindersInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid toggle input", parsed.error.issues);
  }

  if (!isLiveDb()) {
    return { ok: true, data: { enabled: parsed.data.enabled } };
  }

  const tenant = await resolveTenantContext();
  try {
    const agency = await repoUpdateRenewalReminders(tenant, parsed.data);
    revalidatePath("/settings/agency");
    return { ok: true, data: { enabled: agency.renewalRemindersEnabled } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't update notification setting.",
    };
  }
}
