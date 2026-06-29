"use server";

import { z } from "zod";
import { randomUUID } from "node:crypto";
import { MemberRole } from "@prisma/client";
import { assertRole, requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { getR2Client, signR2UploadUrl } from "@/server/storage/r2";

export type SignArtworkResult =
  | {
      ok: true;
      data: { uploadUrl: string; objectKey: string; publicUrl: string };
    }
  | { ok: false; error: string };

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;

const input = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1),
});

/**
 * Mint a pre-signed PUT URL for direct-to-R2 artwork upload.
 *
 * Returns the URL the browser PUTs to + the final public URL the client
 * record should reference. We rely on `NEXT_PUBLIC_R2_PUBLIC_BASE_URL`
 * pointing at a Cloudflare custom domain (or worker) that serves R2
 * objects publicly; without it we can't compose a stable display URL,
 * so the action fails clearly.
 */
export async function signArtworkUploadAction(raw: unknown): Promise<SignArtworkResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid upload request", parsed.error.issues);
  }
  const { filename, contentType } = parsed.data;
  if (!ALLOWED_TYPES.includes(contentType as (typeof ALLOWED_TYPES)[number])) {
    return {
      ok: false,
      error: `Unsupported content type ${contentType}. Use JPG, PNG, WebP, or AVIF.`,
    };
  }

  const auth = await requireAuthContext();
  assertRole(auth, [MemberRole.OWNER, MemberRole.ADMIN]);

  if (!getR2Client()) {
    return {
      ok: false,
      error:
        "R2 is not configured (set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET).",
    };
  }
  const publicBase = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL;
  if (!publicBase) {
    return {
      ok: false,
      error:
        "Set NEXT_PUBLIC_R2_PUBLIC_BASE_URL to your R2 public domain to enable artwork upload.",
    };
  }

  // Scope keys by agency so cross-tenant access is impossible even if R2 ACLs
  // misfire. Random suffix prevents same-name collisions.
  const extension =
    filename
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "bin";
  const objectKey = `artwork/${auth.agency.id}/${randomUUID()}.${extension}`;

  const uploadUrl = await signR2UploadUrl(objectKey, contentType, 600);
  const publicUrl = `${publicBase.replace(/\/$/, "")}/${objectKey}`;

  return { ok: true, data: { uploadUrl, objectKey, publicUrl } };
}
