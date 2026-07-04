import { UserButton } from "@clerk/nextjs";
import { auth, currentUser } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/landing/nav";
import { getOnboardingStateForUser } from "@/server/db/agencies";
import { isLiveDb } from "@/server/data/source";

/**
 * `/onboarding/*` shell — revamp visual system (see `ref/UI/Revamp/`).
 *
 * Gate: unauthenticated → /sign-in. Users who already have a live Stripe
 * subscription short-circuit to /dashboard (in case they land here by
 * refreshing after finishing checkout). Everything else — no agency yet
 * OR agency-but-no-sub — passes through to whichever substep the child
 * route renders.
 *
 * Visual system (drift from the app-wide shell):
 *   - Page background is a solid cool white (`#f6f8fc`), no ambient
 *     gradients. Content is meant to feel product-y, not landing-y.
 *   - Topbar is a solid white bar with the wordmark on the left and a
 *     "email · avatar" cluster on the right (mirrors the ref mock). No
 *     backdrop-blur / translucency — the topbar reads as a UI chrome
 *     surface, not a marketing header.
 *   - Content column widens to ~1080px so the plan-comparison table can
 *     stretch out without horizontal scroll.
 *   - Typography swaps to Schibsted Grotesk (sans) + Spline Sans Mono
 *     (mono) via `--font-revamp-*` — see `app/globals.css`.
 */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  let userEmail: string | null = null;
  if (isLiveDb()) {
    const { userId } = await auth();
    if (!userId) redirect("/sign-in?redirect_url=%2Fonboarding");
    const state = await getOnboardingStateForUser(userId);
    if (state.kind === "paying") redirect("/dashboard");
    const user = await currentUser().catch(() => null);
    userEmail =
      user?.emailAddresses?.find((e) => e.id === user?.primaryEmailAddressId)?.emailAddress ??
      user?.emailAddresses?.[0]?.emailAddress ??
      null;
  }
  return (
    <div
      className="relative flex min-h-screen w-full flex-col overflow-x-hidden"
      style={{
        background: "#f6f8fc",
        color: "#0a1e3c",
        fontFamily: "var(--font-revamp-sans)",
      }}
    >
      <header
        className="sticky top-0 z-20 w-full"
        style={{ background: "#ffffff", borderBottom: "1px solid #eef1f6" }}
      >
        <div className="mx-auto flex h-[58px] w-full max-w-[1200px] items-center justify-between px-6 sm:px-10">
          <Link
            href="/"
            className="no-underline transition-opacity hover:opacity-80"
            aria-label="Repodcast home"
          >
            <BrandMark />
          </Link>
          <div className="flex items-center gap-4">
            {userEmail ? (
              <span className="hidden sm:inline" style={{ fontSize: 13, color: "#8a97ad" }}>
                {userEmail}
              </span>
            ) : null}
            <UserButton appearance={{ elements: { avatarBox: "h-8 w-8" } }} />
          </div>
        </div>
      </header>

      <main className="relative z-10 flex w-full flex-1 justify-center">
        <div className="w-full max-w-[1080px] px-5 py-10 sm:px-8 sm:py-14 lg:py-[52px]">
          {children}
        </div>
      </main>
    </div>
  );
}
