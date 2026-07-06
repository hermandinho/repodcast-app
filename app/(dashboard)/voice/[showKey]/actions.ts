"use server";

import { Platform } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import {
  rateVoiceDescription,
  rateVoiceDescriptionInput,
  saveVoiceInstructions,
} from "@/server/db/show-instructions";
import { isLiveDb } from "@/server/data/source";
import { inngest } from "@/inngest/client";

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

const saveInput = z.object({
  showId: z.string().min(1),
  global: z.string().max(2000).optional(),
  // Partial: client sends only the platforms it surfaces; missing keys are
  // interpreted as "delete the rule" on the server.
  perPlatform: z.record(z.nativeEnum(Platform), z.string().max(1000)).optional(),
});

export async function saveVoiceInstructionsAction(
  raw: unknown,
): Promise<ActionResult<{ showId: string }>> {
  const parsed = saveInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid voice-instructions input", parsed.error.issues);
  }
  const { showId, global, perPlatform } = parsed.data;

  if (!isLiveDb()) {
    return { ok: true, data: { showId } };
  }

  const auth = await requireAuthContext();
  await saveVoiceInstructions(toTenantContext(auth), {
    showId,
    global,
    perPlatform,
  });

  // Voice rules affect downstream prompt assembly + the voice page;
  // refresh both layouts.
  revalidatePath("/voice", "layout");
  revalidatePath("/clients", "layout");
  revalidatePath("/shows", "layout");
  return { ok: true, data: { showId } };
}

/**
 * Record the operator's "is this your voice?" verdict on the current
 * `Show.voiceDescription`. A negative rating (`approved: false`) fires
 * `voice/refresh.requested` so the description gets regenerated — the
 * refresh handler resets `voiceDescriptionApproved` to `null` after it
 * writes the new description, so the operator can rate the fresh one on
 * its own merit.
 *
 * The refresh dispatch is best-effort: an Inngest outage must not roll
 * back the rating write. The badge/UI on the page will still surface
 * "not your voice" so the operator knows their verdict landed even if
 * the queue hiccups.
 */
export async function rateVoiceDescriptionAction(
  raw: unknown,
): Promise<ActionResult<{ showId: string; approved: boolean }>> {
  const parsed = rateVoiceDescriptionInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid voice-rating input", parsed.error.issues);
  }
  const { showId, approved } = parsed.data;

  if (!isLiveDb()) {
    return { ok: true, data: { showId, approved } };
  }

  const auth = await requireAuthContext();
  const { shouldRegenerate } = await rateVoiceDescription(toTenantContext(auth), {
    showId,
    approved,
  });

  if (shouldRegenerate) {
    try {
      await inngest.send({
        name: "voice/refresh.requested",
        data: { showId },
      });
    } catch (err) {
      console.error("voice/refresh.requested dispatch failed (rate)", err);
    }
  }

  revalidatePath("/voice", "layout");
  return { ok: true, data: { showId, approved } };
}
