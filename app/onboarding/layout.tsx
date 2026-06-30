import { auth } from "@clerk/nextjs/server";
import { OnboardingStep } from "@prisma/client";
import { redirect } from "next/navigation";
import { getOnboardingStepForUser } from "@/server/db/agencies";
import { isLiveDb } from "@/server/data/source";

/**
 * Inverse of the dashboard layout's onboarding gate: if the user is signed
 * in *and* has finished the wizard, send them straight to the dashboard.
 *
 * Phase 2.10 swap: we used to redirect on the cheaper "do you have any
 * Member row" check, but that yanked users with a created agency but an
 * unfinished step 2/3 over to the dashboard, defeating the resume promise.
 * Now we redirect iff `onboardingStep === DONE` — any earlier step keeps
 * the user in the wizard so they pick up where they left off.
 *
 * Sample-data mode skips the check — the demo tenant is always "set up".
 */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  if (isLiveDb()) {
    const { userId } = await auth();
    if (!userId) redirect("/sign-in");
    const step = await getOnboardingStepForUser(userId);
    if (step === OnboardingStep.DONE) redirect("/dashboard");
  }
  return (
    <div
      className="relative min-h-screen w-full overflow-hidden"
      style={{
        background: "radial-gradient(120% 80% at 100% 0%, #EEF2FB 0%, #F4F6FA 45%, #F4F6FA 100%)",
        color: "#1A2A4A",
      }}
    >
      {/* Decorative orb — adds visual depth without dominating */}
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

      <div className="relative mx-auto flex min-h-screen max-w-[600px] flex-col justify-center px-5 py-8 sm:py-10">
        {children}
      </div>
    </div>
  );
}
