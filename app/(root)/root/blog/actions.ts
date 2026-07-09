"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z, ZodError } from "zod";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth/errors";
import {
  assertSystemRole,
  requireSystemAdminContext,
  SYSTEM_WRITE_ROLES,
} from "@/server/auth/system";
import { deleteBlogPost, upsertBlogPost, type UpsertBlogPostInput } from "@/server/db/system/blog";
import { deleteSystemConfig, upsertSystemConfig } from "@/server/db/system/config";
import { BLOG_INDEX_OG_IMAGE_KEY } from "@/lib/blog-index-og";
import { slugify } from "@/lib/blog";
import { getR2Client, signR2UploadUrl } from "@/server/storage/r2";

/**
 * Server actions behind `/root/blog`.
 *
 * Same shape as `/root/config/actions.ts`: gate → helper (which enforces
 * role + wraps the mutation in `withSystemAudit`) → redirect back with an
 * `?ok=` or `?error=` code. Every write revalidates BOTH the admin surface
 * and the public `/blog` surface so a status flip goes live immediately.
 */

export async function upsertBlogPostAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();

  const id = strOrUndef(formData.get("id"));
  const title = strOrEmpty(formData.get("title"));
  // Client-side auto-sync usually fills this in; on JS-off submissions we
  // derive it from the title so the author never sees a "slug required"
  // error for a field they didn't know existed.
  const slug = strOrEmpty(formData.get("slug")) || slugify(title);

  const input: UpsertBlogPostInput = {
    id,
    slug,
    title,
    excerpt: strOrEmpty(formData.get("excerpt")),
    bodyMarkdown: strOrEmpty(formData.get("bodyMarkdown")),
    coverImageUrl: strOrUndef(formData.get("coverImageUrl")),
    category: strOrUndef(formData.get("category")),
    tags: splitList(formData.get("tags")),
    readingMinutes: numOrUndef(formData.get("readingMinutes")),
    status: coerceStatus(formData.get("status")),
    publishedAt: strOrUndef(formData.get("publishedAt")),
    metaTitle: strOrUndef(formData.get("metaTitle")),
    metaDescription: strOrUndef(formData.get("metaDescription")),
    canonicalUrl: strOrUndef(formData.get("canonicalUrl")),
    noindex: formData.get("noindex") === "on" || formData.get("noindex") === "true",
    keywords: splitList(formData.get("keywords")),
    structuredDataJson: strOrUndef(formData.get("structuredDataJson")),
    note: strOrUndef(formData.get("note")),
  };

  let savedId: string;
  try {
    const saved = await upsertBlogPost(ctx, input);
    savedId = saved.id;
  } catch (err) {
    const target = id ? `/root/blog/${id}` : "/root/blog/new";
    const detail =
      err instanceof ValidationError ? `&detail=${encodeURIComponent(err.message)}` : "";
    redirect(`${target}?error=${errCode(err)}${detail}`);
  }

  revalidatePath("/root/blog");
  revalidatePath("/blog");
  revalidatePath(`/blog/${slug}`);
  redirect(`/root/blog/${savedId}?ok=1`);
}

export async function deleteBlogPostAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();
  const id = strOrEmpty(formData.get("id"));
  const slug = strOrUndef(formData.get("slug"));

  try {
    await deleteBlogPost(ctx, {
      id,
      note: strOrEmpty(formData.get("note")),
    });
  } catch (err) {
    redirect(`/root/blog/${id}?error=${errCode(err)}`);
  }

  revalidatePath("/root/blog");
  revalidatePath("/blog");
  if (slug) revalidatePath(`/blog/${slug}`);
  redirect("/root/blog?ok=deleted");
}

// ============================================================
// Blog index social share image — `BLOG_INDEX_OG_IMAGE_URL`
// ============================================================

/**
 * Persists the `/blog` OG / Twitter card image URL under the
 * `BLOG_INDEX_OG_IMAGE_URL` SystemConfig key. Also handles the "clear" case
 * (empty submission → delete the key so the reader falls back to no image
 * rather than a persisted empty string).
 *
 * Reuses `upsertSystemConfig` / `deleteSystemConfig` so the mutation lands
 * an audit row exactly like the /root/config surface — the upload UI on
 * /root/blog is only ergonomics; the storage plumbing is shared.
 */
export async function saveBlogIndexOgImageAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);

  const raw = strOrUndef(formData.get("ogImageUrl"));

  try {
    if (!raw) {
      // Clearing the field wipes the key. `deleteSystemConfig` requires a
      // note; supply a canonical one so the operator doesn't have to type
      // one for a routine reset.
      await deleteSystemConfig(ctx, {
        key: BLOG_INDEX_OG_IMAGE_KEY,
        note: "Cleared blog index OG image via /root/blog upload widget",
      }).catch((err: unknown) => {
        // Deleting a key that doesn't exist yet is a no-op from the
        // operator's perspective — swallow the "not found" and treat the
        // submission as successful.
        if (err instanceof NotFoundError) return;
        throw err;
      });
    } else {
      await upsertSystemConfig(ctx, {
        key: BLOG_INDEX_OG_IMAGE_KEY,
        valueJson: JSON.stringify({ url: raw }),
        description: "Blog index OG / Twitter card image (managed via /root/blog).",
      });
    }
  } catch (err) {
    redirect(`/root/blog?error=${errCode(err)}`);
  }

  revalidatePath("/root/blog");
  revalidatePath("/blog");
  redirect("/root/blog?ok=og_image");
}

// ============================================================
// Image upload — pre-signed direct-to-R2 PUT
// ============================================================

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
] as const;

const signImageInput = z.object({
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(100),
});

export type SignBlogImageResult =
  | { ok: true; uploadUrl: string; publicUrl: string; objectKey: string }
  | { ok: false; error: string };

/**
 * Mint a pre-signed PUT URL for a blog image. Same shape as the tenant-side
 * `signArtworkUploadAction` — browser PUTs the file straight to R2 and we
 * only ever see the resulting public URL, which the admin stores on the
 * `BlogPost` row via the normal save action.
 *
 * Object key layout: `blog/<random-uuid>.<ext>`. Random suffix avoids
 * collisions when two admins upload files with the same name.
 *
 * Requires:
 *   - R2_* env vars (see `server/storage/r2.ts`).
 *   - NEXT_PUBLIC_R2_PUBLIC_BASE_URL — Cloudflare custom domain or worker
 *     that serves the bucket publicly. Without it we can't compose the
 *     stable `<img>` URL the admin needs.
 */
export async function signBlogImageUploadAction(raw: unknown): Promise<SignBlogImageResult> {
  const ctx = await requireSystemAdminContext();
  // Same write-role posture as the rest of `/root/blog`: SUPPORT / ANALYST
  // can view the surface but not mutate content.
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);

  const parsed = signImageInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid upload request." };
  }
  const { filename, contentType } = parsed.data;

  if (!ALLOWED_IMAGE_TYPES.includes(contentType as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return {
      ok: false,
      error: `Unsupported content type ${contentType}. Use JPG, PNG, WebP, AVIF, or GIF.`,
    };
  }

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
        "Set NEXT_PUBLIC_R2_PUBLIC_BASE_URL to your R2 public domain to enable blog image upload.",
    };
  }

  const extension =
    filename
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "bin";
  const objectKey = `blog/${randomUUID()}.${extension}`;

  const uploadUrl = await signR2UploadUrl(objectKey, contentType, 600);
  const publicUrl = `${publicBase.replace(/\/$/, "")}/${objectKey}`;

  return { ok: true, uploadUrl, publicUrl, objectKey };
}

// ============================================================
// Helpers
// ============================================================

function strOrEmpty(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v : "";
}

function strOrUndef(v: FormDataEntryValue | null): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function numOrUndef(v: FormDataEntryValue | null): number | undefined {
  if (typeof v !== "string") return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

function splitList(v: FormDataEntryValue | null): string[] {
  if (typeof v !== "string") return [];
  return v
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function coerceStatus(v: FormDataEntryValue | null): UpsertBlogPostInput["status"] {
  const raw = typeof v === "string" ? v : "";
  if (raw === "DRAFT" || raw === "SCHEDULED" || raw === "PUBLISHED" || raw === "ARCHIVED") {
    return raw;
  }
  return "DRAFT";
}

function errCode(err: unknown): string {
  if (err instanceof ZodError) return "invalid";
  if (err instanceof ValidationError) return "invalid";
  if (err instanceof NotFoundError) return "not_found";
  if (err instanceof ForbiddenError) return "forbidden";
  return "unknown";
}
