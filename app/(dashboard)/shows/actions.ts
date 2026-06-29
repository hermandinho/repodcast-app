"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ValidationError } from "@/server/auth/errors";
import {
  createShow as repoCreateShow,
  createShowInput,
  deleteShow as repoDeleteShow,
  updateShow as repoUpdateShow,
  updateShowInput,
} from "@/server/db/shows";
import { isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

// ============================================================
// Create
// ============================================================

export async function createShowAction(raw: unknown): Promise<ActionResult<{ showId: string }>> {
  const parsed = createShowInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid show input", parsed.error.issues);
  }

  if (!isLiveDb()) {
    // Sample-data mode — no DB write. Synthetic id keeps the modal closing
    // cleanly while the seeded fixtures keep rendering.
    return { ok: true, data: { showId: "demo-new" } };
  }

  const tenant = await resolveTenantContext();
  const show = await repoCreateShow(tenant, parsed.data);
  revalidatePath("/shows");
  revalidatePath("/clients", "layout");
  revalidatePath("/dashboard");
  return { ok: true, data: { showId: show.id } };
}

// ============================================================
// Update
// ============================================================

const updateWithId = z.object({ showId: z.string().min(1) }).and(updateShowInput);

export async function updateShowAction(raw: unknown): Promise<ActionResult<{ showId: string }>> {
  const parsed = updateWithId.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid show update", parsed.error.issues);
  }
  const { showId, ...patch } = parsed.data;

  if (!isLiveDb()) {
    return { ok: true, data: { showId } };
  }

  const tenant = await resolveTenantContext();
  await repoUpdateShow(tenant, showId, patch);
  revalidatePath("/shows", "layout");
  revalidatePath("/clients", "layout");
  return { ok: true, data: { showId } };
}

// ============================================================
// Delete
// ============================================================

const deleteInput = z.object({ showId: z.string().min(1) });

export async function deleteShowAction(raw: unknown): Promise<ActionResult<{ showId: string }>> {
  const parsed = deleteInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid delete input", parsed.error.issues);
  }
  const { showId } = parsed.data;

  if (!isLiveDb()) {
    return { ok: true, data: { showId } };
  }

  const tenant = await resolveTenantContext();
  await repoDeleteShow(tenant, showId);
  // Cascade deletes (Episode, VoiceSample, ShowPlatformInstruction) mean
  // every dependent page needs a refetch.
  revalidatePath("/shows", "layout");
  revalidatePath("/clients", "layout");
  revalidatePath("/episodes", "layout");
  revalidatePath("/voice", "layout");
  return { ok: true, data: { showId } };
}
