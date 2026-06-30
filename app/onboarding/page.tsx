import { auth, currentUser } from "@clerk/nextjs/server";
import { OnboardingStep } from "@prisma/client";
import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { getOnboardingStepForUser } from "@/server/db/agencies";
import { isLiveDb } from "@/server/data/source";

/**
 * Phase 2.10 — initial step lookup. The layout has already redirected DONE
 * users, so anything we see here is either pre-agency (null → step 1) or a
 * mid-flow resume (TEAMMATES → step 2, CLIENT → step 3).
 */
function initialStepFor(persisted: OnboardingStep | null): "workspace" | "teammates" | "client" {
  switch (persisted) {
    case OnboardingStep.TEAMMATES:
      return "teammates";
    case OnboardingStep.CLIENT:
      return "client";
    case OnboardingStep.WORKSPACE:
    case OnboardingStep.DONE: // layout should have redirected, but be defensive
    case null:
    default:
      return "workspace";
  }
}

export default async function OnboardingPage() {
  let persistedStep: OnboardingStep | null = null;
  if (isLiveDb()) {
    const { userId } = await auth();
    if (!userId) redirect("/sign-in");
    persistedStep = await getOnboardingStepForUser(userId);
  }

  const user = await currentUser().catch(() => null);
  const firstName = user?.firstName?.trim() || null;
  const suggestedAgencyName = firstName ? `${firstName}'s Studio` : "My Studio";

  return (
    <OnboardingWizard
      suggestedAgencyName={suggestedAgencyName}
      initialStep={initialStepFor(persistedStep)}
    />
  );
}
