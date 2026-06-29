import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { isLiveDb } from "@/server/data/source";

export default async function OnboardingPage() {
  if (isLiveDb()) {
    const { userId } = await auth();
    if (!userId) redirect("/sign-in");
  }

  const user = await currentUser().catch(() => null);
  const firstName = user?.firstName?.trim() || null;
  const suggestedAgencyName = firstName ? `${firstName}'s Studio` : "My Studio";

  return <OnboardingWizard suggestedAgencyName={suggestedAgencyName} />;
}
