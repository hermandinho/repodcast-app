import { NextResponse } from "next/server";
import { SLUG_REGEX } from "@/lib/blog";
import { recordPublicBlogUpvote } from "@/server/db/blog-public";

/**
 * `POST /api/blog/[slug]/upvote` — anonymous +1 on the post's upvote
 * counter.
 * `DELETE /api/blog/[slug]/upvote` — the corresponding -1 (floored at 0
 * inside `recordPublicBlogUpvote` so a rogue DELETE loop can't push it
 * negative).
 *
 * Dedup is client-side (`localStorage` per slug, matches the view beacon
 * pattern). The server intentionally does NOT enforce one-vote-per-user
 * — anonymous voting without a session would need IP hashing / a KV store,
 * neither of which we ship yet. The counter is best-effort editorial
 * signal, same posture as `viewCount`.
 *
 * Bot filter: quick UA regex. Most crawlers skip JS so they never hit
 * this route, but the ones that DO run JS (Googlebot, social scrapers,
 * headless-chrome) get silently dropped so they don't inflate counts.
 *
 * Response shape is stable across success + bot-drop + DB-error so the
 * client can treat it as fire-and-forget.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BOT_UA =
  /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|whatsapp|slackbot|twitterbot|linkedinbot|discordbot|telegrambot|prerender|headlesschrome|phantomjs|puppeteer|python-requests|curl\/|wget\//i;

type RouteParams = { slug: string };

async function toggle(
  req: Request,
  { params }: { params: Promise<RouteParams> },
  direction: "add" | "remove",
): Promise<NextResponse> {
  const { slug } = await params;

  if (!SLUG_REGEX.test(slug) || slug.length > 96) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const ua = req.headers.get("user-agent") ?? "";
  if (!ua || BOT_UA.test(ua)) {
    // Drop bots silently — the client never inspects the response.
    return NextResponse.json({ ok: true });
  }

  try {
    await recordPublicBlogUpvote(slug, direction);
  } catch {
    // Non-fatal. Same posture as the view beacon: a lost vote beats a
    // 500 that Sentry pages on.
  }

  return NextResponse.json({ ok: true });
}

export function POST(req: Request, ctx: { params: Promise<RouteParams> }): Promise<NextResponse> {
  return toggle(req, ctx, "add");
}

export function DELETE(req: Request, ctx: { params: Promise<RouteParams> }): Promise<NextResponse> {
  return toggle(req, ctx, "remove");
}
