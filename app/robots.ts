import type { MetadataRoute } from "next";

/**
 * Phase 3.1 — robots directive. Written as `app/robots.ts` so it renders
 * dynamically off `NEXT_PUBLIC_APP_URL` (Vercel preview builds get a
 * host-scoped sitemap URL instead of a hardcoded prod one).
 *
 * Allow-list is narrow — every non-marketing surface is either tenant-
 * gated or admin-only, so we don't want them indexed. Sitemap points
 * crawlers at the URLs we DO care about.
 */
export default function robots(): MetadataRoute.Robots {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://repodcast.io");
  const cleanBase = base.replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/pricing", "/legal/", "/sign-in", "/sign-up"],
        // Everything under these prefixes is either auth-gated or an
        // internal surface we don't want spidered. Also cuts crawl
        // budget waste on server-only paths that return 404s to bots.
        disallow: [
          "/dashboard",
          "/dashboard/",
          "/settings/",
          "/episodes/",
          "/clients/",
          "/shows/",
          "/schedule",
          "/team",
          "/voice/",
          "/root/",
          "/api/",
          "/onboarding/",
          "/after-sign-in",
          "/invite/",
          "/portal/",
        ],
      },
    ],
    sitemap: `${cleanBase}/sitemap.xml`,
  };
}
