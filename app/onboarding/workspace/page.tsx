import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { WorkspaceForm } from "@/components/onboarding/workspace-form";
import { getOnboardingStateForUser } from "@/server/db/agencies";
import { isLiveDb } from "@/server/data/source";

export const dynamic = "force-dynamic";

/**
 * Step 1 of the new onboarding: name the workspace.
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
    <div className="flex flex-col gap-8">
      <StepChrome active={1} />
      <header className="text-center">
        <h1 className="font-display text-[28px] font-semibold tracking-tight">
          Name your workspace
        </h1>
        <p className="mt-2 text-[13.5px] text-[#5B6A85]">
          This is what teammates and clients see. You can rename it any time from Settings.
        </p>
      </header>
      <WorkspaceForm suggestedName={suggestedName} passthroughQs={qs} />
    </div>
  );
}

function StepChrome({ active }: { active: 1 | 2 }) {
  const dot = (n: 1 | 2) => (
    <span
      key={n}
      aria-current={active === n ? "step" : undefined}
      className={"h-2 w-2 rounded-full " + (active === n ? "bg-[#1A2A4A]" : "bg-[#1A2A4A]/25")}
    />
  );
  return (
    <ol className="mx-auto flex items-center gap-2 font-mono text-[11.5px] tracking-wider text-[#5B6A85] uppercase">
      {dot(1)}
      <span>Workspace</span>
      <span className="h-px w-6 bg-[#1A2A4A]/20" />
      {dot(2)}
      <span>Plan</span>
    </ol>
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
