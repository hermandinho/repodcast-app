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
});

export const config = {
  matcher: [
    // Skip Next internals and static files (.css, .js, images, fonts, etc.)
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run on API routes
    "/(api|trpc)(.*)",
  ],
};
