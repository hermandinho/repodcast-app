import { NextResponse } from "next/server";
import { SLUG_REGEX } from "@/lib/blog";
import { recordPublicBlogView } from "@/server/db/blog-public";

/**
 * `POST /api/blog/[slug]/view` — best-effort page-view counter for public
 * blog posts. Fires from a client-side beacon (`components/blog/view-beacon`)
 * on mount, once per session per slug.
 *
 * Design notes:
 *   - Node runtime (Prisma isn't Edge-compatible in this project).
 *   - `force-dynamic` — never cache; each hit is a mutation.
 *   - The endpoint is intentionally cheap: one `updateMany` (silent no-op
 *     when the slug doesn't exist or is unpublished — see
 *     `recordPublicBlogView`), no auth, no session lookup, no rate-limit
 *     store. The dedup is client-side (`sessionStorage` per slug per tab)
 *     because centralising it here would need a KV store we don't ship yet.
 *   - Bot filter: quick regex on `User-Agent`. Most crawlers skip JS and
 *     never fire the beacon; this catches the JS-executing ones (Googlebot,
 *     headless-chrome, prerender.io, social-scrapers).
 *   - Returns `{ ok: true }` on both success and dropped-as-bot to keep the
 *     shape stable; the client doesn't care and never reads the body.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOT_UA =
  /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|whatsapp|slackbot|twitterbot|linkedinbot|discordbot|telegrambot|prerender|headlesschrome|phantomjs|puppeteer|python-requests|curl\/|wget\//i;

type RouteParams = { slug: string };

export async function POST(
  req: Request,
  { params }: { params: Promise<RouteParams> },
): Promise<NextResponse> {
  const { slug } = await params;

  // Cheap format guard — reject anything that isn't a valid slug shape
  // before we touch the DB. Prevents casual noise + trivial abuse.
  if (!SLUG_REGEX.test(slug) || slug.length > 96) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const ua = req.headers.get("user-agent") ?? "";
  if (!ua || BOT_UA.test(ua)) {
    // Silently drop bot traffic. The client never inspects the response.
    return NextResponse.json({ ok: true });
  }

  try {
    await recordPublicBlogView(slug);
  } catch {
    // Increment failures are non-fatal — a lost view is preferable to a
    // 500 that Sentry pages on. The DB will surface a real outage via the
    // health check.
  }

  return NextResponse.json({ ok: true });
}
