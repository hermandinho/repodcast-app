"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertActiveSubscription, requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import {
  createClient as repoCreateClient,
  createClientInput,
  deleteClient as repoDeleteClient,
  updateClient as repoUpdateClient,
  updateClientInput,
  updateClientWorkflow as repoUpdateClientWorkflow,
  updateClientWorkflowInput,
} from "@/server/db/clients";
import { prisma } from "@/server/db/client";
import { trackServer } from "@/server/analytics/track";
import { isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

// ============================================================
// Create
// ============================================================

export async function createClientAction(
  raw: unknown,
): Promise<ActionResult<{ clientId: string }>> {
  const parsed = createClientInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid client input", parsed.error.issues);
  }

  if (!isLiveDb()) {
    // Sample-data mode — no DB write. Return a synthetic id so the modal
    // can close cleanly and the UI keeps rendering its fixtures.
    return { ok: true, data: { clientId: "demo-new" } };
  }

  // Refuse when the sub is canceled — the dashboard layout gate can't
  // catch a form submitted after the tab was open when Stripe fired
  // `subscription.deleted`, so the check has to live at the action.
  const auth = await requireAuthContext();
  assertActiveSubscription(auth);
  const tenant = toTenantContext(auth);

  // Onboarding funnel: count BEFORE the create so we can fire
  // `first_client_added` exactly once per agency, not once per create.
  // Read-then-write is safe here — a parallel create from the same agency
  // would just lose the race + neither would over-fire (post-create count
  // would be 2+ on the loser, gating it out).
  const priorClientCount = await prisma.client.count({
    where: { agencyId: tenant.agencyId },
  });

  const client = await repoCreateClient(tenant, parsed.data);
  // "/" layout so the (dashboard) layout — where the Topbar's ClientSwitcher
  // lives — re-renders. `revalidatePath("/clients", ...)` only reaches
  // segments AT OR BELOW `/clients`, missing the ancestor layout.
  revalidatePath("/", "layout");

  if (priorClientCount === 0) {
    await trackServer(
      "first_client_added",
      { agencyId: tenant.agencyId, clientId: client.id },
      { distinctId: `agency:${tenant.agencyId}`, agencyId: tenant.agencyId },
    );
  }

  return { ok: true, data: { clientId: client.id } };
}

// ============================================================
// Update
// ============================================================

const updateWithId = z.object({ clientId: z.string().min(1) }).and(updateClientInput);

export async function updateClientAction(
  raw: unknown,
): Promise<ActionResult<{ clientId: string }>> {
  const parsed = updateWithId.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid client update", parsed.error.issues);
  }
  const { clientId, ...patch } = parsed.data;

  if (!isLiveDb()) {
    return { ok: true, data: { clientId } };
  }

  const tenant = await resolveTenantContext();
  await repoUpdateClient(tenant, clientId, patch);
  // Root-layout revalidation so the Topbar's ClientSwitcher picks up the
  // new name/artwork — it reads clients in the (dashboard) layout, which
  // is an ancestor of `/clients` and would otherwise stay cached.
  revalidatePath("/", "layout");
  return { ok: true, data: { clientId } };
}

// ============================================================
// Workflow settings — validation mode + notification recipients
// ============================================================

const updateWorkflowWithId = z
  .object({ clientId: z.string().min(1) })
  .and(updateClientWorkflowInput);

export async function updateClientWorkflowAction(
  raw: unknown,
): Promise<ActionResult<{ clientId: string }>> {
  const parsed = updateWorkflowWithId.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid workflow input", parsed.error.issues);
  }
  const { clientId, ...patch } = parsed.data;

  if (!isLiveDb()) {
    return { ok: true, data: { clientId } };
  }

  const tenant = await resolveTenantContext();
  await repoUpdateClientWorkflow(tenant, clientId, patch);
  // Root-layout revalidation covers the client detail chrome, any
  // outputs-view pages downstream that read `validationMode`, and the
  // Topbar's ClientSwitcher (which lives above `/clients`).
  revalidatePath("/", "layout");
  return { ok: true, data: { clientId } };
}

// ============================================================
// Delete
// ============================================================

const deleteInput = z.object({ clientId: z.string().min(1) });

export async function deleteClientAction(
  raw: unknown,
): Promise<ActionResult<{ clientId: string }>> {
  const parsed = deleteInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid delete input", parsed.error.issues);
  }
  const { clientId } = parsed.data;

  if (!isLiveDb()) {
    return { ok: true, data: { clientId } };
  }

  const tenant = await resolveTenantContext();
  await repoDeleteClient(tenant, clientId);
  // Cascade deletes (Episode, VoiceSample, ClientPlatformInstruction)
  // mean every page surface needs a refetch — including the Topbar's
  // ClientSwitcher in the (dashboard) layout above `/clients`.
  revalidatePath("/", "layout");
  return { ok: true, data: { clientId } };
}
