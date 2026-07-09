import "server-only";

import { BlogPostStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import {
  assertSystemRole,
  SYSTEM_READ_ROLES,
  SYSTEM_WRITE_ROLES,
  type SystemAdminContext,
} from "@/server/auth/system";
import { NotFoundError, ValidationError } from "@/server/auth/errors";
import { prisma } from "@/server/db/client";
import { estimateReadingMinutes, SLUG_REGEX } from "@/lib/blog";
import { SYSTEM_AUDIT_ACTIONS } from "./audit-actions";
import { withSystemAudit } from "./audit";

/**
 * Platform-admin CRUD helpers behind `/root/blog`. Every write flows through
 * `withSystemAudit` — the `SystemAuditLog` row and the mutation share one
 * `prisma.$transaction`, so we never end up with content changes that don't
 * have an audit trail.
 *
 * Reads are open to every system role (auditors need to see drafts too);
 * writes are gated to ROOT / OPERATOR.
 */

// ============================================================
// Row shape returned to the admin UI
// ============================================================

export type BlogPostRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  bodyMarkdown: string;
  coverImageUrl: string | null;
  category: string | null;
  tags: string[];
  readingMinutes: number | null;
  status: BlogPostStatus;
  publishedAt: Date | null;
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  noindex: boolean;
  keywords: string[];
  structuredDataJson: Prisma.JsonValue | null;
  viewCount: number;
  upvoteCount: number;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; email: string; name: string | null } | null;
  updatedBy: { id: string; email: string; name: string | null } | null;
};

const rowSelect = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  bodyMarkdown: true,
  coverImageUrl: true,
  category: true,
  tags: true,
  readingMinutes: true,
  status: true,
  publishedAt: true,
  metaTitle: true,
  metaDescription: true,
  canonicalUrl: true,
  noindex: true,
  keywords: true,
  structuredDataJson: true,
  viewCount: true,
  upvoteCount: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, email: true, name: true } },
  updatedBy: { select: { id: true, email: true, name: true } },
} as const satisfies Prisma.BlogPostSelect;

function toRow(r: Prisma.BlogPostGetPayload<{ select: typeof rowSelect }>): BlogPostRow {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    bodyMarkdown: r.bodyMarkdown,
    coverImageUrl: r.coverImageUrl,
    category: r.category,
    tags: r.tags,
    readingMinutes: r.readingMinutes,
    status: r.status,
    publishedAt: r.publishedAt,
    metaTitle: r.metaTitle,
    metaDescription: r.metaDescription,
    canonicalUrl: r.canonicalUrl,
    noindex: r.noindex,
    keywords: r.keywords,
    structuredDataJson: r.structuredDataJson ?? null,
    viewCount: r.viewCount,
    upvoteCount: r.upvoteCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    author: r.author,
    updatedBy: r.updatedBy,
  };
}

// ============================================================
// Reads
// ============================================================

export const listBlogPostsInput = z.object({
  status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"]).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
});

export async function listBlogPostsForAdmin(
  ctx: SystemAdminContext,
  rawInput: Partial<z.input<typeof listBlogPostsInput>> = {},
): Promise<BlogPostRow[]> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);
  const input = listBlogPostsInput.parse(rawInput);

  const where: Prisma.BlogPostWhereInput = {};
  if (input.status) where.status = input.status;
  if (input.search) {
    where.OR = [
      { title: { contains: input.search, mode: "insensitive" } },
      { slug: { contains: input.search, mode: "insensitive" } },
    ];
  }

  const rows = await prisma.blogPost.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: input.take,
    select: rowSelect,
  });
  return rows.map(toRow);
}

export async function getBlogPostByIdForAdmin(
  ctx: SystemAdminContext,
  id: string,
): Promise<BlogPostRow | null> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);
  const row = await prisma.blogPost.findUnique({ where: { id }, select: rowSelect });
  return row ? toRow(row) : null;
}

// ============================================================
// Writes
// ============================================================

const optionalTrimmedString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

const optionalUrl = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined))
    .refine(
      (v) => v === undefined || /^https?:\/\//.test(v) || v.startsWith("/"),
      "Must be an absolute http(s) URL or a site-relative path starting with /",
    );

export const upsertBlogPostInput = z.object({
  /** Present on update, undefined on create. */
  id: z.string().trim().min(1).optional(),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(96)
    .regex(SLUG_REGEX, "slug must be lower-kebab-case (a-z, 0-9, dashes)"),
  title: z.string().trim().min(1).max(180),
  excerpt: z.string().trim().min(1).max(320),
  bodyMarkdown: z.string().min(1).max(60_000),
  coverImageUrl: optionalUrl(500),
  category: optionalTrimmedString(60),
  /** Comma- or newline-separated in the UI, normalised to string[]. */
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  readingMinutes: z.coerce.number().int().min(1).max(120).optional(),
  status: z.enum(["DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"]),
  publishedAt: z.coerce.date().optional(),
  metaTitle: optionalTrimmedString(70),
  metaDescription: optionalTrimmedString(200),
  canonicalUrl: optionalUrl(500),
  noindex: z.coerce.boolean().default(false),
  keywords: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  /** Raw JSON string typed by the admin; parsed here. */
  structuredDataJson: z
    .string()
    .trim()
    .max(20_000)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  note: z.string().trim().max(500).optional(),
});
export type UpsertBlogPostInput = z.input<typeof upsertBlogPostInput>;

export async function upsertBlogPost(
  ctx: SystemAdminContext,
  rawInput: UpsertBlogPostInput,
): Promise<BlogPostRow> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = upsertBlogPostInput.parse(rawInput);

  const structuredData = parseStructuredData(input.structuredDataJson);
  const publishedAt = resolvePublishedAt(input.status, input.publishedAt);
  const readingMinutes = input.readingMinutes ?? estimateReadingMinutes(input.bodyMarkdown);

  const isCreate = !input.id;
  const auditAction = isCreate
    ? SYSTEM_AUDIT_ACTIONS.BLOG_CREATE
    : SYSTEM_AUDIT_ACTIONS.BLOG_UPDATE;

  return withSystemAudit(
    ctx,
    {
      action: auditAction,
      targetEntityType: "blog_post",
      targetEntityId: input.id ?? input.slug,
      note: input.note ?? null,
    },
    async (tx, audit) => {
      const before = input.id
        ? await tx.blogPost.findUnique({ where: { id: input.id }, select: rowSelect })
        : null;
      if (input.id && !before) throw new NotFoundError(`BlogPost ${input.id} not found`);
      audit.setBefore(before);

      // Slug collisions surface as a friendly ValidationError instead of the
      // raw P2002 that Prisma would throw at commit.
      const clash = await tx.blogPost.findFirst({
        where: { slug: input.slug, ...(input.id ? { NOT: { id: input.id } } : {}) },
        select: { id: true },
      });
      if (clash) {
        throw new ValidationError(`slug "${input.slug}" is already in use by another post`);
      }

      const data = {
        slug: input.slug,
        title: input.title,
        excerpt: input.excerpt,
        bodyMarkdown: input.bodyMarkdown,
        coverImageUrl: input.coverImageUrl ?? null,
        category: input.category ?? null,
        tags: input.tags,
        readingMinutes,
        status: input.status,
        publishedAt,
        metaTitle: input.metaTitle ?? null,
        metaDescription: input.metaDescription ?? null,
        canonicalUrl: input.canonicalUrl ?? null,
        noindex: input.noindex,
        keywords: input.keywords,
        // Prisma's typed JSON field: use `JsonNull` sentinel to clear, not
        // literal `null` (which the generated types reject).
        structuredDataJson: structuredData ?? Prisma.JsonNull,
        updatedByAdminId: ctx.admin.id,
      } satisfies Prisma.BlogPostUncheckedUpdateInput;

      const after = input.id
        ? await tx.blogPost.update({
            where: { id: input.id },
            data,
            select: rowSelect,
          })
        : await tx.blogPost.create({
            data: { ...data, authorAdminId: ctx.admin.id },
            select: rowSelect,
          });

      audit.setAfter(after);
      return toRow(after);
    },
  );
}

export const deleteBlogPostInput = z.object({
  id: z.string().trim().min(1),
  /** Required — hard delete has to carry an audit reason. */
  note: z.string().trim().min(3).max(500),
});

export async function deleteBlogPost(
  ctx: SystemAdminContext,
  rawInput: z.input<typeof deleteBlogPostInput>,
): Promise<void> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = deleteBlogPostInput.parse(rawInput);

  await withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.BLOG_DELETE,
      targetEntityType: "blog_post",
      targetEntityId: input.id,
      note: input.note,
    },
    async (tx, audit) => {
      const before = await tx.blogPost.findUnique({ where: { id: input.id }, select: rowSelect });
      if (!before) throw new NotFoundError(`BlogPost ${input.id} not found`);
      audit.setBefore(before);
      audit.setAfter(null);
      await tx.blogPost.delete({ where: { id: input.id } });
    },
  );
}

// ============================================================
// Helpers
// ============================================================

function parseStructuredData(raw: string | undefined): Prisma.InputJsonValue | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Prisma.InputJsonValue;
  } catch (err) {
    throw new ValidationError(
      `structuredDataJson is not valid JSON: ${err instanceof Error ? err.message : "parse error"}`,
    );
  }
}

/**
 * `publishedAt` follows the status. PUBLISHED with no date → stamp now.
 * SCHEDULED requires a future date; the admin picks one. Drafts and
 * archived posts null-out (they aren't publicly visible).
 */
function resolvePublishedAt(status: BlogPostStatus, chosen: Date | undefined): Date | null {
  if (status === "DRAFT" || status === "ARCHIVED") return null;
  if (status === "SCHEDULED") {
    if (!chosen) throw new ValidationError("Scheduled posts require a publishedAt date");
    if (chosen.getTime() <= Date.now()) {
      throw new ValidationError("Scheduled publishedAt must be in the future");
    }
    return chosen;
  }
  return chosen ?? new Date();
}
