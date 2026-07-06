import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BrandMark } from "@/components/landing/nav";
import { getSystemAdminContext } from "@/server/auth/system";
// Import from the tiny helper module (not `@/server/data/source`) so this
// routing shim doesn't pull the whole data-source graph — and its
// `server/db/outputs.ts` chain — through the CI build's import resolver.
import { isLiveDb } from "@/server/data/is-live-db";
import { getOnboardingStateForUser } from "@/server/db/agencies";

/**
 * Post-authentication destination router.
 *
 * Sits between Clerk's sign-in / sign-up completion and whichever surface
 * the user should actually see. Resolves in this order:
 *
 *   1. Unauthed → back to /sign-in (defensive; Clerk normally won't land here).
 *   2. SystemAdmin row for this Clerk user → /root
 *      (ROOT-only users have no tenant Member row, so the /dashboard gate
 *      would otherwise bounce them into /onboarding, which is nonsense.)
 *   3. Live tenant sub → /dashboard
 *   4. Membership without sub, but previously subscribed (canceled /
 *      expired trial) → /settings/billing. The `/settings/*` allowlist in
 *      the dashboard layout lets them in without a sub, so they can
 *      resubscribe or navigate to Agency → Delete workspace. Sending
 *      them to /onboarding/plan traps them there (the "Continue" CTA on
 *      the landing header does the same round-trip).
 *   5. Membership without sub, never subscribed → /onboarding (router
 *      picks /plan — first-time plan pick uses the onboarding chrome).
 *   6. No membership at all → /onboarding (router picks /workspace)
 *
 * Wired as `fallbackRedirectUrl` on `<SignIn>` and `<SignUp>`, and used as
 * the "Open dashboard" href on the landing so signed-in users always land
 * at the right surface for their role — no matter how they arrived.
 *
 * The heavy lookups (Clerk `currentUser()` + two Prisma reads) run inside a
 * `<Suspense>` boundary so the outer splash streams to the browser
 * immediately — the user sees "Setting up your workspace…" instead of a
 * blank URL while Vercel warms a cold Prisma pool. Each lookup is capped by
 * `LOOKUP_TIMEOUT_MS`; on timeout or DB error we fall through to
 * `/onboarding`, whose router re-checks state and forwards paying users to
 * `/dashboard` automatically.
 *
 * Sample-data mode short-circuits to /dashboard since there's no live DB
 * to interrogate.
 */
export const dynamic = "force-dynamic";

const LOOKUP_TIMEOUT_MS = 4000;

export default function AfterSignInPage() {
  return (
    <AuthLoadingSplash>
      <Suspense fallback={null}>
        <ResolveDestination />
      </Suspense>
    </AuthLoadingSplash>
  );
}

async function ResolveDestination(): Promise<null> {
  if (!isLiveDb()) redirect("/dashboard");

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Runs the admin lookup and onboarding-state lookup concurrently, each
  // wrapped in a hard timeout. Redirect targets are computed into
  // `destination` inside the try; the actual `redirect()` fires outside so
  // its `NEXT_REDIRECT` sentinel can never be swallowed by the catch.
  let destination = "/onboarding";
  try {
    const [admin, state] = await Promise.all([
      withTimeout(getSystemAdminContext(), LOOKUP_TIMEOUT_MS),
      withTimeout(getOnboardingStateForUser(userId), LOOKUP_TIMEOUT_MS),
    ]);
    if (admin) destination = "/root";
    else if (state.kind === "paying") destination = "/dashboard";
    else if (state.kind === "no-subscription" && state.hadPriorSubscription) {
      // Returning canceled subscriber — drop them into Billing so they
      // can resubscribe or reach the Agency danger zone. The dashboard
      // layout allowlists `/settings/*` for the no-sub state.
      destination = "/settings/billing";
    }
    // Fresh no-subscription / no-membership fall through to /onboarding.
  } catch {
    // Timeout or DB blip: /onboarding is the safe fallback. Its layout
    // re-runs the state check and forwards paying users to /dashboard on
    // its own. Worst case, a SystemAdmin loses one direct /root hop and
    // clicks through from the nav.
  }
  redirect(destination);
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("after-sign-in lookup timeout")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function AuthLoadingSplash({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden"
      style={{
        background: "radial-gradient(120% 80% at 100% 0%, #EEF2FB 0%, #F4F6FA 45%, #F4F6FA 100%)",
        color: "#1A2A4A",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-32 h-[420px] w-[420px] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(58,91,160,0.16) 0%, rgba(58,91,160,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -left-32 h-[460px] w-[460px] rounded-full"
        style={{
          background: "radial-gradient(circle, rgba(46,158,91,0.12) 0%, rgba(46,158,91,0) 70%)",
        }}
      />
      <div className="relative flex flex-col items-center gap-5 px-6 text-center">
        <BrandMark />
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="h-4 w-4 animate-spin rounded-full border-2 border-[#3A5BA0]/25 border-t-[#3A5BA0]"
          />
          <p
            className="m-0 font-sans text-[14px] font-medium"
            style={{ color: "#5A6473" }}
            role="status"
            aria-live="polite"
          >
            Setting up your workspace…
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}
