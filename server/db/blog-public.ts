import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";

/**
 * Read helpers for the PUBLIC `/blog/*` surface. Deliberately separate from
 * `server/db/system/blog.ts` — the tenant / anonymous reader has no
 * `SystemAdminContext`, and shouldn't route through the audited write helpers
 * just to fetch a row.
 *
 * Row shape excludes `bodyMarkdown` on the index (payload savings) and only
 * exposes the fields the public renderer needs.
 */

export type PublicBlogListItem = {
  slug: string;
  title: string;
  excerpt: string;
  coverImageUrl: string | null;
  category: string | null;
  tags: string[];
  publishedAt: Date;
  readingMinutes: number | null;
  author: { name: string | null } | null;
};

export type PublicBlogPost = PublicBlogListItem & {
  bodyMarkdown: string;
  metaTitle: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  noindex: boolean;
  keywords: string[];
  structuredDataJson: Prisma.JsonValue | null;
  updatedAt: Date;
};

/**
 * Live posts: any PUBLISHED row, OR a SCHEDULED row whose `publishedAt` has
 * passed. Two rules, one filter — SCHEDULED flips live automatically when
 * its timestamp passes (no cron needed).
 *
 * We deliberately DO NOT gate PUBLISHED on `publishedAt <= now`. The admin
 * clicking "Publish" is the source of truth; the timestamp is display
 * metadata (byline). Gating on it made backdated posts show fine but
 * silently hid any post whose stored `publishedAt` landed in the future —
 * trivially triggered by the `datetime-local` input, which submits a
 * timezone-less string that the server parses in its own local time.
 */
function livePostsWhere(now = new Date()): Prisma.BlogPostWhereInput {
  return {
    OR: [{ status: "PUBLISHED" }, { status: "SCHEDULED", publishedAt: { lte: now, not: null } }],
  };
}

export async function listPublicBlogPosts(opts?: {
  take?: number;
  category?: string;
}): Promise<PublicBlogListItem[]> {
  const rows = await prisma.blogPost.findMany({
    where: {
      ...livePostsWhere(),
      ...(opts?.category ? { category: opts.category } : {}),
    },
    orderBy: [{ publishedAt: "desc" }],
    take: opts?.take ?? 50,
    select: {
      slug: true,
      title: true,
      excerpt: true,
      coverImageUrl: true,
      category: true,
      tags: true,
      publishedAt: true,
      readingMinutes: true,
      author: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    coverImageUrl: r.coverImageUrl,
    category: r.category,
    tags: r.tags,
    publishedAt: r.publishedAt as Date,
    readingMinutes: r.readingMinutes,
    author: r.author,
  }));
}

export async function getPublicBlogPostBySlug(slug: string): Promise<PublicBlogPost | null> {
  const row = await prisma.blogPost.findFirst({
    where: { slug, ...livePostsWhere() },
    select: {
      slug: true,
      title: true,
      excerpt: true,
      bodyMarkdown: true,
      coverImageUrl: true,
      category: true,
      tags: true,
      publishedAt: true,
      readingMinutes: true,
      metaTitle: true,
      metaDescription: true,
      canonicalUrl: true,
      noindex: true,
      keywords: true,
      structuredDataJson: true,
      updatedAt: true,
      author: { select: { name: true } },
    },
  });
  if (!row) return null;
  return {
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    bodyMarkdown: row.bodyMarkdown,
    coverImageUrl: row.coverImageUrl,
    category: row.category,
    tags: row.tags,
    publishedAt: row.publishedAt as Date,
    readingMinutes: row.readingMinutes,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    canonicalUrl: row.canonicalUrl,
    noindex: row.noindex,
    keywords: row.keywords,
    structuredDataJson: row.structuredDataJson ?? null,
    updatedAt: row.updatedAt,
    author: row.author,
  };
}

/**
 * Sitemap helper — only slug + updatedAt (the crawler doesn't need anything
 * else). `updatedAt` is what `lastModified` maps to; if we ever want a
 * strict content-modification timestamp we'd need a separate column.
 */
export async function listPublicBlogPostSlugsForSitemap(): Promise<
  { slug: string; updatedAt: Date }[]
> {
  return prisma.blogPost.findMany({
    where: livePostsWhere(),
    orderBy: [{ publishedAt: "desc" }],
    select: { slug: true, updatedAt: true },
  });
}

/**
 * Simple related-posts heuristic: prefer posts sharing the most tags with
 * the current one, then the newest. Excludes the current post. Falls back
 * to the most-recent non-current posts when no tag overlap exists.
 */
export async function listRelatedPublicPosts(opts: {
  currentSlug: string;
  tags: string[];
  take?: number;
}): Promise<PublicBlogListItem[]> {
  const take = opts.take ?? 3;
  const candidates = await prisma.blogPost.findMany({
    where: {
      ...livePostsWhere(),
      slug: { not: opts.currentSlug },
    },
    orderBy: [{ publishedAt: "desc" }],
    take: 24,
    select: {
      slug: true,
      title: true,
      excerpt: true,
      coverImageUrl: true,
      category: true,
      tags: true,
      publishedAt: true,
      readingMinutes: true,
      author: { select: { name: true } },
    },
  });

  const tagSet = new Set(opts.tags);
  const scored = candidates.map((c) => ({
    row: c,
    score: c.tags.reduce((n, t) => n + (tagSet.has(t) ? 1 : 0), 0),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const bTime = b.row.publishedAt?.getTime() ?? 0;
    const aTime = a.row.publishedAt?.getTime() ?? 0;
    return bTime - aTime;
  });

  return scored.slice(0, take).map(({ row }) => ({
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    coverImageUrl: row.coverImageUrl,
    category: row.category,
    tags: row.tags,
    publishedAt: row.publishedAt as Date,
    readingMinutes: row.readingMinutes,
    author: row.author,
  }));
}
