import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { OnboardingStepHeader } from "@/components/onboarding/onboarding-step-header";
import { WorkspaceForm } from "@/components/onboarding/workspace-form";
import { getOnboardingStateForUser } from "@/server/db/agencies";
import { isLiveDb } from "@/server/data/source";

export const dynamic = "force-dynamic";

/**
 * Step 1: name the workspace.
 *
 * Users who already have an Agency skip forward to /onboarding/plan (or
 * /dashboard if they're paying). Users who somehow reach this without a
 * Clerk session get bounced to /sign-in by the layout.
 */
export default async function OnboardingWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = passthroughParams(params);
  const suffix = qs ? `?${qs}` : "";

  if (isLiveDb()) {
    const { userId } = await auth();
    if (!userId) redirect("/sign-in?redirect_url=%2Fonboarding%2Fworkspace");
    const state = await getOnboardingStateForUser(userId);
    if (state.kind === "no-subscription") redirect(`/onboarding/plan${suffix}`);
    if (state.kind === "paying") redirect("/dashboard");
  }

  const user = await currentUser().catch(() => null);
  const firstName = user?.firstName?.trim() || null;
  const suggestedName = firstName ? `${firstName}'s Studio` : "My Studio";

  return (
    <div className="flex flex-col" style={{ gap: 40 }}>
      <OnboardingStepHeader
        step="workspace"
        title="Name your workspace"
        subtitle="This is what teammates and clients see. You can rename it any time from Settings."
      />
      <div className="mx-auto w-full" style={{ maxWidth: 520 }}>
        <div
          style={{
            background: "#fff",
            border: "1px solid #e4e9f1",
            borderRadius: 14,
            padding: 28,
            boxShadow: "0 1px 2px rgba(10,30,60,0.04)",
          }}
        >
          <WorkspaceForm suggestedName={suggestedName} passthroughQs={qs} />
        </div>
      </div>
    </div>
  );
}

function passthroughParams(params: Record<string, string | string[] | undefined>): string {
  const out = new URLSearchParams();
  for (const key of ["plan", "cadence", "currency"] as const) {
    const value = params[key];
    if (typeof value === "string" && value) out.set(key, value);
  }
  return out.toString();
}
