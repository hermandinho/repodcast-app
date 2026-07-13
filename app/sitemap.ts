import type { MetadataRoute } from "next";
import { listPublicBlogPostSlugsForSitemap } from "@/server/db/blog-public";

/**
 * Public sitemap.
 *
 * Only lists surfaces we want crawled. Deliberately omits:
 *   - `/dashboard`, `/settings/*`, `/episodes/*`, `/clients/*` — auth-
 *     gated tenant surface, no value in an index.
 *   - `/root/*` — platform-admin surface, `middleware.ts` bounces
 *     unauthenticated visitors to `notFound()` so the URL is
 *     deliberately unmentioned anywhere public.
 *   - `/api/*` — server routes.
 *   - `/portal/[token]` — token-gated per-client surface; each token is
 *     ephemeral and unique, no value in a static index entry.
 *
 * `changeFrequency` is a soft hint to crawlers, not a promise. Update
 * cadence tracks reality: landing + pricing move on marketing pushes,
 * legal moves rarely.
 *
 * Blog posts are folded in dynamically — every live post lands as its own
 * `<url>` entry, using `updatedAt` for `lastModified`.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://repodcastapp.com");
  const cleanBase = base.replace(/\/$/, "");
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = [
    {
      url: `${cleanBase}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${cleanBase}/pricing`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${cleanBase}/about`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${cleanBase}/contact`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${cleanBase}/blog`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${cleanBase}/legal/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: `${cleanBase}/legal/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: `${cleanBase}/legal/security`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: `${cleanBase}/legal/report`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${cleanBase}/sign-in`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: `${cleanBase}/sign-up`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.6,
    },
  ];

  // Blog posts flow through Prisma → sitemap. `listPublicBlogPostSlugsForSitemap`
  // filters to live rows (PUBLISHED / SCHEDULED-past-date). A blip in the DB
  // shouldn't take the whole sitemap down, so we swallow failures and let the
  // static list ship on its own.
  let blogEntries: MetadataRoute.Sitemap = [];
  try {
    const posts = await listPublicBlogPostSlugsForSitemap();
    blogEntries = posts.map((post) => ({
      url: `${cleanBase}/blog/${post.slug}`,
      lastModified: post.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    }));
  } catch {
    blogEntries = [];
  }

  return [...staticEntries, ...blogEntries];
}
