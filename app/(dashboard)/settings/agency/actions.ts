"use server";

import { clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { MemberRole, TrialStatus } from "@prisma/client";
import { assertRole, requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { prisma } from "@/server/db/client";
import { getR2Client, quarantineR2AgencyPrefixes } from "@/server/storage/r2";
import { trackServer } from "@/server/analytics/track";
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
 * Delete the active workspace (Agency) end-to-end. OWNER-only — ADMIN
 * can't nuke the workspace they were merely invited to.
 *
 * Preconditions (returned as errors, not thrown):
 *   1. `confirmName` must exactly match the current agency name — the
 *      user types it into the danger-zone form so a stray click can't
 *      shred a workspace.
 *   2. No active Stripe subscription. `stripeSubscriptionId != null` OR
 *      `trialStatus === ACTIVE` both count — we refuse and tell the
 *      user to cancel via Billing → Manage subscription first. The
 *      `customer.subscription.deleted` webhook nulls `stripeSubscriptionId`
 *      once Stripe finalises the cancellation, unblocking this path.
 *
 * Order of operations (each step best-effort where noted so a partial
 * failure doesn't strand the caller in a half-deleted workspace):
 *
 *   1. Fire `workspace_deleted` PostHog event — must run BEFORE the DB
 *      delete or the event loses its agency group.
 *   2. R2 quarantine (`quarantineR2AgencyPrefixes`) — moves audio/
 *      artwork prefixes to `_quarantine/<agencyId>/<isoTs>/` for
 *      recovery. Skipped if R2 isn't configured. Failures are logged
 *      and swallowed — orphaned R2 objects can be swept later, but a
 *      hung DB delete would strand the user.
 *   3. `prisma.agency.deleteMany` — cascades through every child model
 *      (`onDelete: Cascade` on Members, Clients, Shows, Episodes,
 *      GeneratedOutputs, UsageLogs, Invoices, Integrations, etc.).
 *      SystemAuditLog rows survive by design (`onDelete: Restrict`).
 *      We use `deleteMany` (not `delete`) so a webhook race that beat
 *      us to the row doesn't throw P2025 — idempotent by design.
 *   4. Delete Clerk organisation (if `clerkOrgId` was set). Failures
 *      swallowed — the org may already be gone via a prior webhook,
 *      and an orphaned Clerk org is harmless (no members, no billing).
 *   5. Delete the actor's Clerk user via `users.deleteUser`. This
 *      invalidates their session — the redirect below will land them
 *      at the marketing homepage as an anonymous visitor.
 *
 * The `redirect("/")` at the end throws `NEXT_REDIRECT`, so the return
 * type is `never` on success. On precondition failure, we return an
 * `ActionResult` so the client can surface an inline error.
 */
const deleteWorkspaceInput = z.object({
  confirmName: z.string().min(1),
});

export async function deleteWorkspaceAction(raw: unknown): Promise<ActionResult<never>> {
  const parsed = deleteWorkspaceInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid delete input", parsed.error.issues);
  }

  const auth = await requireAuthContext();
  assertRole(auth, [MemberRole.OWNER]);

  if (!isLiveDb()) {
    return {
      ok: false,
      error: "Workspace deletion is disabled in sample-data mode.",
    };
  }

  const agency = await prisma.agency.findUnique({
    where: { id: auth.agency.id },
    select: {
      id: true,
      name: true,
      plan: true,
      clerkOrgId: true,
      stripeSubscriptionId: true,
      trialStatus: true,
    },
  });
  if (!agency) {
    return { ok: false, error: "Workspace not found." };
  }
  if (parsed.data.confirmName.trim() !== agency.name.trim()) {
    return {
      ok: false,
      error: `Type the workspace name exactly ("${agency.name}") to confirm.`,
    };
  }
  if (agency.stripeSubscriptionId || agency.trialStatus === TrialStatus.ACTIVE) {
    return {
      ok: false,
      error:
        "Cancel your subscription first — go to Billing → Manage subscription. Once Stripe confirms the cancellation you can delete this workspace.",
    };
  }

  await trackServer(
    "workspace_deleted",
    { agencyId: agency.id, plan: agency.plan },
    { distinctId: `agency:${agency.id}`, agencyId: agency.id },
  );

  if (getR2Client() !== null) {
    try {
      await quarantineR2AgencyPrefixes(agency.id, new Date().toISOString());
    } catch (err) {
      console.error("[delete-workspace] R2 quarantine failed", { agencyId: agency.id, err });
    }
  }

  await prisma.agency.deleteMany({ where: { id: agency.id } });

  if (agency.clerkOrgId) {
    try {
      const client = await clerkClient();
      await client.organizations.deleteOrganization(agency.clerkOrgId);
    } catch (err) {
      console.error("[delete-workspace] Clerk org delete failed", {
        clerkOrgId: agency.clerkOrgId,
        err,
      });
    }
  }

  try {
    const client = await clerkClient();
    await client.users.deleteUser(auth.user.clerkUserId);
  } catch (err) {
    // Non-fatal — the workspace is already gone. User can retry
    // account deletion from Clerk's own UserProfile if desired.
    console.error("[delete-workspace] Clerk user delete failed", {
      clerkUserId: auth.user.clerkUserId,
      err,
    });
  }

  // Session is invalidated; middleware will bounce to sign-in.
  redirect("/");
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
