import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/landing/nav";
import { getOnboardingStateForUser } from "@/server/db/agencies";
import { isLiveDb } from "@/server/data/source";

/**
 * `/onboarding/*` shell.
 *
 * Gate: unauthenticated → /sign-in. Users who already have a live Stripe
 * subscription short-circuit to /dashboard (in case they land here by
 * refreshing after finishing checkout). Everything else — no agency yet
 * OR agency-but-no-sub — passes through to whichever substep the child
 * route renders.
 *
 * Layout structure:
 *   - Sticky top nav: BrandMark (left) + UserButton (right). Hugs the true
 *     viewport edges via a full-width flex row so on wide monitors the two
 *     don't cluster next to the centered content column.
 *   - Body: top-aligned centered column (max-w-4xl) so long content
 *     (comparison table on the plan step) scrolls naturally instead of
 *     being vertically centered and pushed off-screen.
 *
 * Fully responsive:
 *   - `px-4 → sm:px-6 → lg:px-8` horizontal padding at three breakpoints.
 *   - Sticky nav shrinks vertical padding on narrow viewports.
 *   - Background decor scales down + off-viewport on mobile so it never
 *     clips the content card.
 */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  if (isLiveDb()) {
    const { userId } = await auth();
    if (!userId) redirect("/sign-in?redirect_url=%2Fonboarding");
    const state = await getOnboardingStateForUser(userId);
    if (state.kind === "paying") redirect("/dashboard");
  }
  return (
    <div
      className="relative flex min-h-screen w-full flex-col overflow-x-hidden"
      style={{
        background: "radial-gradient(120% 80% at 100% 0%, #EEF2FB 0%, #F4F6FA 45%, #F4F6FA 100%)",
        color: "#1A2A4A",
      }}
    >
      {/* Ambient background decor — pointer-events-none, hidden below sm to
          keep the mobile view clean. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 hidden h-[420px] w-[420px] rounded-full sm:block"
        style={{
          background: "radial-gradient(circle, rgba(58,91,160,0.16) 0%, rgba(58,91,160,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-24 hidden h-[460px] w-[460px] rounded-full sm:block"
        style={{
          background: "radial-gradient(circle, rgba(46,158,91,0.12) 0%, rgba(46,158,91,0) 70%)",
        }}
      />

      <header className="sticky top-0 z-20 w-full border-b border-black/[0.06] bg-white/70 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="no-underline transition-opacity hover:opacity-80"
            aria-label="Repodcast home"
          >
            <BrandMark />
          </Link>
          <div className="flex items-center">
            <UserButton appearance={{ elements: { avatarBox: "h-8 w-8" } }} />
          </div>
        </div>
      </header>

      <main className="relative z-10 flex w-full flex-1 justify-center">
        <div className="w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8 lg:py-14">
          {children}
        </div>
      </main>
    </div>
  );
}
