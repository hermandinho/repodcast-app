import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getOnboardingStateForUser } from "@/server/db/agencies";
import { isLiveDb } from "@/server/data/source";

export const dynamic = "force-dynamic";

/**
 * Stripe Checkout `success_url` lands here. In the common case the webhook
 * that flips `Agency.stripeSubscriptionId` has already run by the time this
 * page renders (Stripe fires the webhook before the browser redirect
 * resolves), and the DB check below short-circuits to /dashboard.
 *
 * When the webhook is slower than the browser (rare), we render a lightweight
 * "hang tight" screen with a meta-refresh — hitting this same page again in
 * a couple seconds. Every reload re-runs the DB check, so at most two hits
 * to see the sub arrive.
 *
 * Sample-data mode skips the sub check entirely and forwards straight to
 * the dashboard so the demo flow terminates cleanly.
 */
export default async function OnboardingReturnPage() {
  if (!isLiveDb()) {
    redirect("/dashboard");
  }

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const state = await getOnboardingStateForUser(userId);
  if (state.kind === "paying") redirect("/dashboard");
  if (state.kind === "no-membership") redirect("/onboarding/workspace");

  // Sub not yet mirrored — the webhook is on its way. Refresh in ~3s.
  return (
    <>
      <meta httpEquiv="refresh" content="3" />
      <div className="flex flex-col items-center gap-4 text-center">
        <div
          className="h-6 w-6 animate-spin rounded-full border-2 border-[#1A2A4A]/20 border-t-[#1A2A4A]"
          aria-hidden
        />
        <h1 className="font-display text-[22px] font-semibold tracking-tight">
          Finalising your subscription…
        </h1>
        <p className="max-w-[400px] text-[13px] text-[#5B6A85]">
          Stripe is confirming the payment with us. This usually takes a couple of seconds. If the
          page doesn&apos;t move on its own,{" "}
          <a href="/onboarding/return" className="underline">
            refresh here
          </a>
          .
        </p>
      </div>
    </>
  );
}
