import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// NOTE: Next 16 deprecates `middleware.ts` in favour of `proxy.ts` (Node-only).
// Clerk 7.5 ships `clerkMiddleware` but not yet a `clerkProxy` companion, and
// Clerk's docs still target middleware.ts. Track this and switch when Clerk
// publishes proxy.ts support.

const isPublicRoute = createRouteMatcher([
  // Marketing landing — must render for logged-out visitors.
  "/",
  // Public pricing page — drives the self-service signup funnel.
  "/pricing",
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
]);

export default clerkMiddleware(async (auth, req) => {
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
