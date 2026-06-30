"use server";

import { z } from "zod";
import { randomUUID } from "node:crypto";
import { MemberRole } from "@prisma/client";
import { assertRole, requireAuthContext } from "@/server/auth/context";
import { NotFoundError, ValidationError } from "@/server/auth/errors";
import {
  ALLOWED_AUDIO_CONTENT_TYPES,
  MAX_AUDIO_UPLOAD_BYTES,
  audioExtensionFor,
  isAllowedAudioContentType,
} from "@/lib/audio";
import { prisma } from "@/server/db/client";
import { getR2Client, signR2UploadUrl } from "@/server/storage/r2";

/**
 * Phase 2.7 — direct-to-R2 audio upload for the New Episode wizard's
 * "Upload audio" path. Mirrors `signArtworkUploadAction`: the browser PUTs
 * straight to R2 with a 10-minute pre-signed URL, then submits the wizard
 * with the returned object key + pre-minted episodeId. The transcribe
 * Inngest function signs a fresh GET URL from that key.
 *
 * R2 keys are structured `audio/<agencyId>/<showId>/<episodeId>.<ext>` —
 * walkable in the R2 dashboard, trivially deletable on Episode delete
 * (one prefix scan), and the orphan-cleanup cron only has to check that
 * each episodeId still exists in the DB.
 *
 * The episodeId is pre-minted server-side and threaded through to
 * `createEpisodeAction` so the row Prisma creates uses the same id —
 * keeping key ↔ row consistent without a rename round-trip.
 */

export type SignAudioResult =
  | {
      ok: true;
      data: { uploadUrl: string; objectKey: string; episodeId: string };
    }
  | { ok: false; error: string };

const input = z.object({
  showId: z.string().min(1),
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1),
  /** File size in bytes from the browser. Server-side cap, no trust. */
  size: z.number().int().nonnegative(),
});

export async function signAudioUploadAction(raw: unknown): Promise<SignAudioResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid audio upload request", parsed.error.issues);
  }
  const { showId, filename, contentType, size } = parsed.data;

  if (!isAllowedAudioContentType(contentType)) {
    return {
      ok: false,
      error: `Unsupported audio format ${contentType}. Allowed: ${ALLOWED_AUDIO_CONTENT_TYPES.join(", ")}`,
    };
  }
  if (size > MAX_AUDIO_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `File is ${Math.round(size / (1024 * 1024))} MB — limit is ${Math.round(MAX_AUDIO_UPLOAD_BYTES / (1024 * 1024))} MB. Trim the recording or split it.`,
    };
  }

  // EDITOR+ — same gate as createEpisode. REVIEWERs can't upload audio.
  const auth = await requireAuthContext();
  assertRole(auth, [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.EDITOR]);

  // Tenant gate: refuse to sign an URL for a show that doesn't belong to
  // the caller's agency — otherwise a tampered showId could plant audio
  // under another tenant's path prefix.
  const show = await prisma.show.findFirst({
    where: { id: showId, client: { agencyId: auth.agency.id } },
    select: { id: true },
  });
  if (!show) {
    throw new NotFoundError(`Show ${showId} not found`);
  }

  if (!getR2Client()) {
    return {
      ok: false,
      error:
        "R2 is not configured (set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET).",
    };
  }

  // Pre-mint the Episode.id so the R2 key embeds it. The wizard threads
  // this id back into `createEpisodeAction` so the row Prisma creates has
  // the same id — key ↔ row stay consistent without a rename.
  //
  // Episode.id is `String @id @default(cuid())` — Prisma's cuid only fires
  // when no id is supplied, so a UUID works fine. Mixed id formats in the
  // DB are cosmetic; functional behaviour is identical.
  const episodeId = randomUUID();
  const ext = audioExtensionFor(contentType, filename);
  const objectKey = `audio/${auth.agency.id}/${showId}/${episodeId}.${ext}`;

  // 10-minute window — audio uploads are slow on home connections; the
  // signed URL just needs to outlast the user's PUT.
  const uploadUrl = await signR2UploadUrl(objectKey, contentType, 600);

  return { ok: true, data: { uploadUrl, objectKey, episodeId } };
}
