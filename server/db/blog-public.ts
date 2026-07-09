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
  viewCount: number;
  upvoteCount: number;
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
      // Case-insensitive match so the chip UI on `/blog` doesn't require the
      // operator to type exact casing when authoring — "Voice" chip finds
      // "voice", "VOICE", etc.
      ...(opts?.category
        ? { category: { equals: opts.category, mode: "insensitive" as const } }
        : {}),
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
      viewCount: true,
      upvoteCount: true,
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
    viewCount: r.viewCount,
    upvoteCount: r.upvoteCount,
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
      viewCount: true,
      upvoteCount: true,
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
    viewCount: row.viewCount,
    upvoteCount: row.upvoteCount,
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
 * Atomic view-count increment. Called by `POST /api/blog/[slug]/view` from
 * the client beacon. Uses `updateMany` (not `update`) so an unknown or
 * unpublished slug is a silent no-op rather than a P2025 exception — the
 * beacon is fire-and-forget from the client's perspective.
 *
 * Guards on the `livePostsWhere` filter so drafts and archived posts can't
 * accumulate views from stale tabs after unpublish. Returns the number of
 * rows touched (0 when the slug is not live).
 */
export async function recordPublicBlogView(slug: string): Promise<number> {
  const res = await prisma.blogPost.updateMany({
    where: { slug, ...livePostsWhere() },
    data: { viewCount: { increment: 1 } },
  });
  return res.count;
}

/**
 * Anonymous upvote increment / decrement. Called by the client toggle button
 * via `POST` (+1) and `DELETE` (-1) on `/api/blog/[slug]/upvote`.
 *
 * The decrement path guards on `upvoteCount > 0` inside the same WHERE
 * clause so a rogue DELETE loop can't push the counter negative — no
 * separate read/write round-trip, no transaction needed. The increment
 * path has no ceiling (Int max is ~2B, well past anything a blog can
 * realistically accumulate).
 *
 * Returns the number of rows touched. `0` = slug not live, OR (for the
 * decrement path) counter was already at 0. The caller treats both cases
 * as "silent success" — same posture as `recordPublicBlogView`.
 */
export async function recordPublicBlogUpvote(
  slug: string,
  direction: "add" | "remove",
): Promise<number> {
  if (direction === "add") {
    const res = await prisma.blogPost.updateMany({
      where: { slug, ...livePostsWhere() },
      data: { upvoteCount: { increment: 1 } },
    });
    return res.count;
  }
  const res = await prisma.blogPost.updateMany({
    where: { slug, upvoteCount: { gt: 0 }, ...livePostsWhere() },
    data: { upvoteCount: { decrement: 1 } },
  });
  return res.count;
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
      viewCount: true,
      upvoteCount: true,
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
    viewCount: row.viewCount,
    upvoteCount: row.upvoteCount,
    author: row.author,
  }));
}
