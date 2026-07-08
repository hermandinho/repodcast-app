import { listPublicBlogPosts } from "@/server/db/blog-public";
import { escapeHtml } from "@/lib/blog";

/**
 * `/blog/rss.xml` — RSS 2.0 feed of the last 30 published posts.
 *
 * We don't emit the full body (RSS bodies get scraped and re-hosted, which
 * dilutes SEO); only title, link, excerpt, and pubDate. Cache for 5 minutes
 * — same window as the pages themselves.
 */
export const revalidate = 300;

function baseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://repodcastapp.com");
  return raw.replace(/\/$/, "");
}

export async function GET() {
  const base = baseUrl();
  const posts = await listPublicBlogPosts({ take: 30 });

  const items = posts
    .map((post) => {
      const url = `${base}/blog/${post.slug}`;
      const pub = post.publishedAt.toUTCString();
      return [
        "    <item>",
        `      <title>${escapeHtml(post.title)}</title>`,
        `      <link>${url}</link>`,
        `      <guid isPermaLink="true">${url}</guid>`,
        `      <pubDate>${pub}</pubDate>`,
        `      <description>${escapeHtml(post.excerpt)}</description>`,
        post.category ? `      <category>${escapeHtml(post.category)}</category>` : "",
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const lastBuild = posts[0]?.publishedAt.toUTCString() ?? new Date().toUTCString();

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Repodcast blog</title>
    <link>${base}/blog</link>
    <atom:link href="${base}/blog/rss.xml" rel="self" type="application/rss+xml" />
    <description>Notes on voice-true content generation, podcast agency workflows, and shipping Repodcast.</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuild}</lastBuildDate>
${items}
  </channel>
</rss>`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "s-maxage=300, stale-while-revalidate=1800",
    },
  });
}
