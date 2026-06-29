"use server";

import { Platform } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import { saveVoiceInstructions } from "@/server/db/show-instructions";
import { isLiveDb } from "@/server/data/source";

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
