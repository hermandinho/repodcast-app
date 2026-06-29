import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { userHasAnyMembership } from "@/server/db/agencies";
import { isLiveDb } from "@/server/data/source";

/**
 * Inverse of the dashboard layout's onboarding gate: if the user is signed
 * in *and* already belongs to an agency, send them straight back to the
 * dashboard. Stops users from looping through onboarding after they've
 * already created their workspace.
 *
 * Sample-data mode skips the check — the demo tenant is always "set up".
 */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  if (isLiveDb()) {
    const { userId } = await auth();
    if (!userId) redirect("/sign-in");
    if (await userHasAnyMembership(userId)) redirect("/dashboard");
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
