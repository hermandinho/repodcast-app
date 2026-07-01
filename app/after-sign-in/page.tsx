import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getSystemAdminContext } from "@/server/auth/system";
import { isLiveDb } from "@/server/data/source";
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
 *   4. Membership without sub → /onboarding (router picks /plan)
 *   5. No membership at all → /onboarding (router picks /workspace)
 *
 * Wired as `fallbackRedirectUrl` on `<SignIn>` and `<SignUp>`, and used as
 * the "Open dashboard" href on the landing so signed-in users always land
 * at the right surface for their role — no matter how they arrived.
 *
 * Sample-data mode short-circuits to /dashboard since there's no live DB
 * to interrogate.
 */
export const dynamic = "force-dynamic";

export default async function AfterSignInPage() {
  if (!isLiveDb()) redirect("/dashboard");

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Platform employee: never route them through the tenant flow, even if
  // they happen to also hold a Member row somewhere.
  const admin = await getSystemAdminContext();
  if (admin) redirect("/root");

  const state = await getOnboardingStateForUser(userId);
  switch (state.kind) {
    case "paying":
      redirect("/dashboard");
    case "no-subscription":
      redirect("/onboarding");
    case "no-membership":
      redirect("/onboarding");
  }
}
