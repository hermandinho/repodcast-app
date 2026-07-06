"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import {
  addStatementItem,
  addStatementItemInput,
  deleteStatementItem,
  updateStatementItem,
  updateStatementItemInput,
} from "@/server/db/client-statement-items";
import { isLiveDb } from "@/server/data/source";

export type ItemActionResult = { ok: true } | { ok: false; error: string };

/**
 * Add / update / delete a line item on a `ClientStatement`.
 *
 * All three actions are OWNER/ADMIN-gated inside the repo helpers via
 * `requireRole`; the guard fires as `ForbiddenError` for EDITOR/REVIEWER.
 * Sample-data mode short-circuits with a no-op success so the demo
 * flow doesn't wire real writes.
 *
 * Every mutation revalidates the statement detail page and the list
 * page — the list surfaces the item total in each row.
 */

// ============================================================
// Add
// ============================================================

const addWithContext = z
  .object({ clientKey: z.string().min(1), statementId: z.string().min(1) })
  .and(addStatementItemInput);

export async function addStatementItemAction(raw: unknown): Promise<ItemActionResult> {
  const parsed = addWithContext.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid item input", parsed.error.issues);
  }
  const { clientKey, statementId, ...patch } = parsed.data;

  if (!isLiveDb()) return { ok: true };

  const auth = await requireAuthContext();
  try {
    await addStatementItem(toTenantContext(auth), statementId, patch);
    revalidatePath(`/clients/${clientKey}/statements`);
    revalidatePath(`/clients/${clientKey}/statements/${statementId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Add failed." };
  }
}

// ============================================================
// Update
// ============================================================

const updateWithContext = z
  .object({
    clientKey: z.string().min(1),
    statementId: z.string().min(1),
    itemId: z.string().min(1),
  })
  .and(updateStatementItemInput);

export async function updateStatementItemAction(raw: unknown): Promise<ItemActionResult> {
  const parsed = updateWithContext.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid item update", parsed.error.issues);
  }
  const { clientKey, statementId, itemId, ...patch } = parsed.data;

  if (!isLiveDb()) return { ok: true };

  const auth = await requireAuthContext();
  try {
    await updateStatementItem(toTenantContext(auth), itemId, patch);
    revalidatePath(`/clients/${clientKey}/statements`);
    revalidatePath(`/clients/${clientKey}/statements/${statementId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Update failed." };
  }
}

// ============================================================
// Delete
// ============================================================

const deleteWithContext = z.object({
  clientKey: z.string().min(1),
  statementId: z.string().min(1),
  itemId: z.string().min(1),
});

export async function deleteStatementItemAction(raw: unknown): Promise<ItemActionResult> {
  const parsed = deleteWithContext.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid delete input", parsed.error.issues);
  }
  const { clientKey, statementId, itemId } = parsed.data;

  if (!isLiveDb()) return { ok: true };

  const auth = await requireAuthContext();
  try {
    await deleteStatementItem(toTenantContext(auth), itemId);
    revalidatePath(`/clients/${clientKey}/statements`);
    revalidatePath(`/clients/${clientKey}/statements/${statementId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Delete failed." };
  }
}
