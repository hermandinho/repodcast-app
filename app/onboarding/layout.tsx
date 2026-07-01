import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/landing/nav";
import { getOnboardingStateForUser } from "@/server/db/agencies";
import { isLiveDb } from "@/server/data/source";

/**
 * `/onboarding/*` layout.
 *
 * Gate: unauthenticated → /sign-in. Users who already have a live Stripe
 * subscription short-circuit to /dashboard (in case they land here by
 * refreshing after finishing checkout). Everything else — no agency yet
 * OR agency-but-no-sub — passes through to whichever substep the child
 * route renders.
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
      className="relative min-h-screen w-full overflow-hidden"
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

      <div className="relative flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-5 py-5 sm:px-8 sm:py-6">
          <Link href="/" className="no-underline" aria-label="Repodcast home">
            <BrandMark />
          </Link>
          <UserButton />
        </header>
        <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center px-5 pb-10 sm:pb-14">
          {children}
        </main>
      </div>
    </div>
  );
}
