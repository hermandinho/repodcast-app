"use server";

import { TranscriptSource, type Platform } from "@prisma/client";
import { z } from "zod";
import { requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import { createEpisode } from "@/server/db/episodes";
import { isLiveDb } from "@/server/data/source";
import { inngest } from "@/inngest/client";

/**
 * Input is source-aware: PASTE needs a ≥500-char transcript, UPLOAD
 * needs an audioObjectKey (returned by `signAudioUploadAction`). The
 * `.superRefine` mirrors the one in `createEpisodeInput` so the wizard
 * gets a clear field-level error rather than a generic ValidationError.
 */
const createInput = z
  .object({
    showId: z.string().min(1),
    title: z.string().min(1).max(240).optional(),
    transcript: z.string().default(""),
    audioObjectKey: z.string().min(1).optional(),
    /**
     * Pre-minted episodeId returned by `signAudioUploadAction`. Threaded
     * through so the Episode row Prisma creates has the same id as the
     * one embedded in the R2 object key. Required when source is UPLOAD;
     * ignored otherwise (Prisma's `@default(cuid())` fills it).
     */
    episodeId: z.string().min(1).optional(),
    source: z.nativeEnum(TranscriptSource).default(TranscriptSource.PASTE),
    /**
     * Phase 2.8 — RSS path. Publisher GUID + feed URL are pinned onto the
     * Episode at create time so the import function (which may not run
     * for seconds) gets stable lookup keys even if the show's `rssUrl`
     * mutates in the meantime.
     */
    rssGuid: z.string().min(1).optional(),
    rssFeedUrl: z.string().url().optional(),
    /** Title pre-filled from the publisher feed — surfaced as default. */
    rssTitle: z.string().min(1).max(240).optional(),
    platforms: z.array(z.string()).min(1, "Pick at least one platform"),
  })
  .superRefine((data, ctx) => {
    if (data.source === TranscriptSource.PASTE && data.transcript.length < 500) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum: 500,
        origin: "string",
        inclusive: true,
        path: ["transcript"],
        message: "Transcript must be at least 500 characters",
      });
    }
    if (data.source === TranscriptSource.UPLOAD && !data.audioObjectKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["audioObjectKey"],
        message: "Upload audio before generating",
      });
    }
    if (data.source === TranscriptSource.UPLOAD && !data.episodeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["episodeId"],
        message: "Missing pre-minted episodeId — re-upload the audio.",
      });
    }
    if (data.source === TranscriptSource.RSS && (!data.rssGuid || !data.rssFeedUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rssGuid"],
        message: "Pick an episode from the connected feed before generating.",
      });
    }
  });

export type CreateEpisodeInput = z.infer<typeof createInput>;

export type CreateEpisodeResult = { ok: true; episodeId: string } | { ok: false; error: string };

/**
 * Create a new Episode and dispatch the appropriate Inngest pipeline.
 *
 * Sample-data mode (`!isLiveDb()`): no DB write; we navigate the user to
 * the existing sample episode page so the wizard flow stays demo-able
 * without env vars.
 *
 * Live mode, by source:
 *   - PASTE:  Episode created with the supplied transcript → fires
 *             `episode/generate.requested` immediately.
 *   - UPLOAD: Episode created with empty transcript + R2 object key →
 *             fires `episode/transcribe.requested`; the transcribe
 *             pipeline writes the transcript and then fires
 *             `episode/generate.requested` itself.
 *
 * Other sources (RSS, YOUTUBE) are still wizard-stubbed; their action
 * paths land in Phase 2.8 / 3.2.
 */
export async function createEpisodeAction(raw: unknown): Promise<CreateEpisodeResult> {
  const parsed = createInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid episode input", parsed.error.issues);
  }
  const input = parsed.data;
  const platforms = input.platforms as Platform[];

  // Sample-data short-circuit — the wizard still works end-to-end on a
  // fresh clone with no Neon. The showId in this mode is a sample key.
  if (!isLiveDb()) {
    return { ok: true, episodeId: input.showId };
  }

  const auth = await requireAuthContext();
  const tenant = toTenantContext(auth);

  // Pick a sensible title: explicit > publisher-provided > placeholder.
  const resolvedTitle = input.title ?? input.rssTitle ?? "Untitled episode";

  const episode = await createEpisode(tenant, {
    // UPLOAD carries a pre-minted id so Episode.id matches the R2 key.
    // Other sources let Prisma's @default(cuid()) fire.
    id: input.episodeId,
    showId: input.showId,
    title: resolvedTitle,
    transcript: input.transcript,
    source: input.source,
    audioUrl: input.audioObjectKey ?? null,
    // For RSS, stash the publisher GUID on `externalUrl` — it gives the
    // import pipeline a stable lookup key and lets us de-dupe re-imports
    // of the same episode in a future cleanup pass.
    externalUrl: input.source === TranscriptSource.RSS ? (input.rssGuid ?? null) : null,
  });

  if (input.source === TranscriptSource.UPLOAD) {
    await inngest.send({
      name: "episode/transcribe.requested",
      data: { episodeId: episode.id, platforms },
    });
  } else if (input.source === TranscriptSource.RSS) {
    await inngest.send({
      name: "episode/rss.import.requested",
      data: {
        episodeId: episode.id,
        // Validated above by the .superRefine — non-null on this branch.
        guid: input.rssGuid!,
        feedUrl: input.rssFeedUrl!,
        platforms,
      },
    });
  } else {
    await inngest.send({
      name: "episode/generate.requested",
      data: { episodeId: episode.id, platforms },
    });
  }

  return { ok: true, episodeId: episode.id };
}
