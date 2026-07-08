import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// NOTE: Next 16 deprecates `middleware.ts` in favour of `proxy.ts` (Node-only).
// Clerk 7.5 ships `clerkMiddleware` but not yet a `clerkProxy` companion, and
// Clerk's docs still target middleware.ts. Track this and switch when Clerk
// publishes proxy.ts support.

const isPublicRoute = createRouteMatcher([
  // Marketing landing — must render for logged-out visitors.
  "/",
  // Public pricing page — drives the self-service signup funnel.
  "/pricing",
  // Public marketing — About + Contact are linked from the landing
  // footer and must render for logged-out visitors.
  "/about",
  "/contact",
  // Public blog (index + posts + RSS feed). Marketing surface, must
  // render for logged-out visitors and crawlers alike.
  "/blog",
  "/blog/(.*)",
  "/sign-in(.*)",
  "/sign-up(.*)",
  // Invite acceptance lands on /invite/[token] BEFORE the recipient has an
  // account — the page itself routes them to sign-up + back when needed.
  "/invite/(.*)",
  "/api/webhooks/(.*)",
  // Inngest signs its own requests; auth would block the dev-server handshake.
  "/api/inngest(.*)",
  // Uptime probes (Vercel + external monitors) must work without auth.
  "/api/health",
  // Global command-palette search — the route self-gates via
  // `getAuthContext` and returns 401 empty for unauth live-mode callers.
  // Sample-data mode needs to reach the handler without a Clerk session so
  // fresh clones can demo the palette; opting into `isPublicRoute` lets
  // the handler make that decision.
  "/api/search",
  // Phase 2.5 — client portal: the token itself is the credential, no
  // Clerk login required. Route handler validates expiry + revocation.
  "/portal/(.*)",
  // Phase 3.8 — portal-side API routes (e.g. statement PDF download).
  // Each handler re-validates the token; Clerk would 401 otherwise.
  "/api/portal/(.*)",
  // Phase 3.6.10 — public abuse-report intake. Anonymous submission is
  // the whole point; the queue at /root/quality picks it up for triage.
  "/legal/(.*)",
  // Pre-launch splash — when `NEXT_PUBLIC_COMING_SOON="true"` we route
  // every non-allowlisted request to this page. Must be public so the
  // splash itself renders without auth.
  "/coming-soon",
  // File-based metadata routes (Next app-router conventions). Social
  // crawlers and search engines fetch these anonymously — if Clerk's
  // `auth.protect()` runs, they get a 404 rewrite and link previews
  // ship without images, sitemaps go undiscovered, etc. Next appends
  // a content-hash query string to the image routes (e.g.
  // `/opengraph-image?abc123`), so the trailing `(.*)` isn't optional.
  "/opengraph-image(.*)",
  "/twitter-image(.*)",
  "/icon(.*)",
  "/apple-icon(.*)",
  "/sitemap.xml",
  "/robots.txt",
  "/manifest.webmanifest",
]);

/**
 * Paths that stay live even when the coming-soon flag is on. Webhooks,
 * background workers, and health checks must never see the splash — a
 * webhook redirected to HTML would 302 back to Stripe with a garbage
 * body, and Stripe would retry until it gives up.
 */
const isPreLaunchAllowlisted = createRouteMatcher([
  "/coming-soon",
  "/api/webhooks/(.*)",
  "/api/health",
  "/api/inngest(.*)",
]);

const COMING_SOON_ENABLED = process.env.NEXT_PUBLIC_COMING_SOON === "true";

export default clerkMiddleware(async (auth, req) => {
  // Coming-soon short-circuit — runs BEFORE the Clerk auth check so
  // logged-in users also land on the splash (no accidental staff back-
  // door once the flag flips on).
  if (COMING_SOON_ENABLED && !isPreLaunchAllowlisted(req)) {
    const url = req.nextUrl.clone();
    url.pathname = "/coming-soon";
    url.search = "";
    return NextResponse.rewrite(url);
  }

  if (!isPublicRoute(req)) {
    await auth.protect();
  }

  // Expose the request path to server components so layouts can make
  // path-aware decisions without hoisting to a client component. The
  // dashboard layout reads this to whitelist `/settings/*` when the
  // agency has no active subscription (post-cancel resubscribe / delete
  // flow) — without it, the paid-only gate bounces the user to
  // /onboarding/plan the moment their sub is cleared.
  const res = NextResponse.next();
  res.headers.set("x-pathname", req.nextUrl.pathname);
  return res;
});

export const config = {
  matcher: [
    // Skip Next internals and static files (.css, .js, images, fonts,
    // audio/video, etc.). Media extensions (mp4/webm/mp3/…) matter for
    // the landing's demo video under `public/videos/` — without them
    // Clerk's `auth.protect()` fires on the mp4 request and the browser
    // sees a 404 for a file that exists on disk.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|mp4|webm|mov|m4v|mp3|wav|m4a|ogg)).*)",
    // Always run on API routes
    "/(api|trpc)(.*)",
  ],
};
