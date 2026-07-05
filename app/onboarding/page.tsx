import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getOnboardingStateForUser } from "@/server/db/agencies";
import { isLiveDb } from "@/server/data/source";

/**
 * Phase 3.x onboarding router.
 *
 * Reads the user's onboarding state and forwards to the right substep:
 *
 *   no membership                 → /onboarding/workspace (create the Agency)
 *   no sub, never subscribed      → /onboarding/plan      (first-time Stripe pick)
 *   no sub, was subscribed before → /settings/billing     (resubscribe or delete)
 *   paying                        → /dashboard            (done)
 *
 * The returning-subscriber branch avoids the trap where a canceled user
 * bookmarking /onboarding gets round-tripped back to /onboarding/plan —
 * they can now reach the Agency danger zone via Settings.
 *
 * The layout gate above already redirected unauthenticated users to
 * /sign-in, so by the time we get here we always have a Clerk session.
 *
 * Sample-data mode skips the DB round-trip and forwards to the workspace
 * step — the demo tenant is illustrative and always renders "not paying".
 */
export default async function OnboardingRouter({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = passthroughParams(params);
  const suffix = qs ? `?${qs}` : "";

  if (!isLiveDb()) {
    redirect(`/onboarding/workspace${suffix}`);
  }

  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=%2Fonboarding");

  const state = await getOnboardingStateForUser(userId);
  switch (state.kind) {
    case "no-membership":
      redirect(`/onboarding/workspace${suffix}`);
    case "no-subscription":
      if (state.hadPriorSubscription) redirect("/settings/billing");
      redirect(`/onboarding/plan${suffix}`);
    case "paying":
      redirect("/dashboard");
  }
}

/**
 * Keep the plan / cadence / currency pre-selection query alive across the
 * router redirect. Anything else is dropped — we don't want to accidentally
 * echo random URL parameters back to Stripe.
 */
function passthroughParams(params: Record<string, string | string[] | undefined>): string {
  const out = new URLSearchParams();
  for (const key of ["plan", "cadence", "currency"] as const) {
    const value = params[key];
    if (typeof value === "string" && value) out.set(key, value);
  }
  return out.toString();
}
