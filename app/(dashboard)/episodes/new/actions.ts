"use server";

import { TranscriptSource, type Platform } from "@prisma/client";
import { z } from "zod";
import { requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import { createEpisode } from "@/server/db/episodes";
import { isLiveDb } from "@/server/data/source";
import { inngest } from "@/inngest/client";

const createInput = z.object({
  showId: z.string().min(1),
  title: z.string().min(1).max(240).optional(),
  transcript: z.string().min(500, "Transcript must be at least 500 characters"),
  source: z.nativeEnum(TranscriptSource).default(TranscriptSource.PASTE),
  platforms: z.array(z.string()).min(1, "Pick at least one platform"),
});

export type CreateEpisodeInput = z.infer<typeof createInput>;

export type CreateEpisodeResult = { ok: true; episodeId: string } | { ok: false; error: string };

/**
 * Create a new Episode + dispatch the generation pipeline.
 *
 * Sample-data mode (`!isLiveDb()`): no DB write; we navigate the user to
 * the existing sample episode page so the wizard flow stays demo-able
 * without env vars.
 *
 * Live mode: validates input → creates Episode with status DRAFT →
 * fires `episode/generate.requested` Inngest event → returns new id.
 */
export async function createEpisodeAction(raw: unknown): Promise<CreateEpisodeResult> {
  // 1. Validate
  const parsed = createInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid episode input", parsed.error.issues);
  }
  const input = parsed.data;
  const platforms = input.platforms as Platform[];

  // 2. Sample-data short-circuit — the wizard still works end-to-end on a
  //    fresh clone with no Neon. The showId in this mode is a sample key
  //    (ff/te/mt); we route the user to the matching sample episode.
  if (!isLiveDb()) {
    return { ok: true, episodeId: input.showId };
  }

  // 3. Live: auth + tenant scope
  const auth = await requireAuthContext();
  const tenant = toTenantContext(auth);

  // 4. Create the Episode (validates transcript length, enforces show belongs
  //    to the agency through its parent client)
  const episode = await createEpisode(tenant, {
    showId: input.showId,
    title: input.title ?? "Untitled episode",
    transcript: input.transcript,
    source: input.source,
  });

  // 5. Fire the Inngest generation event
  await inngest.send({
    name: "episode/generate.requested",
    data: { episodeId: episode.id, platforms },
  });

  return { ok: true, episodeId: episode.id };
}
