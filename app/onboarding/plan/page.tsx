import { auth } from "@clerk/nextjs/server";
import { BillingCadence, Plan } from "@prisma/client";
import { redirect } from "next/navigation";
import { PricingPicker } from "@/components/pricing/pricing-picker";
import { asSupportedCurrency, DEFAULT_CURRENCY } from "@/lib/currencies";
import { isLiveDb } from "@/server/data/source";
import { getOnboardingStateForUser } from "@/server/db/agencies";
import { checkoutFromOnboardingAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Step 2 of the new onboarding: pick a plan → Stripe Checkout.
 *
 * Gate:
 *   - unauth → /sign-in
 *   - no agency → /onboarding/workspace (workspace has to happen first)
 *   - paying → /dashboard
 *
 * Query pre-selection from /pricing:
 *   plan, cadence, currency — each defaulted to a safe fallback if
 *   the incoming value doesn't parse.
 */
export default async function OnboardingPlanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = passthroughParams(params);
  const suffix = qs ? `?${qs}` : "";

  if (isLiveDb()) {
    const { userId } = await auth();
    if (!userId) redirect("/sign-in?redirect_url=%2Fonboarding%2Fplan");
    const state = await getOnboardingStateForUser(userId);
    if (state.kind === "no-membership") redirect(`/onboarding/workspace${suffix}`);
    if (state.kind === "paying") redirect("/dashboard");
  }

  const initialPlan = parsePlan(params.plan);
  const initialCadence = parseCadence(params.cadence);
  const initialCurrency = asSupportedCurrency(single(params.currency)) ?? DEFAULT_CURRENCY;

  return (
    <div className="flex flex-col gap-8">
      <StepChrome active={2} />
      <header className="text-center">
        <h1 className="font-display text-[28px] font-semibold tracking-tight">Choose a plan</h1>
        <p className="mt-2 text-[13.5px] text-[#5B6A85]">
          Pay by card via Stripe. Annual saves you two months. Switch or cancel any time from
          Settings → Billing.
        </p>
      </header>
      <PricingPicker
        kind="onboarding"
        submit={checkoutFromOnboardingAction}
        initialPlan={initialPlan}
        initialCadence={initialCadence}
        initialCurrency={initialCurrency}
        submittingLabel="Continue to checkout"
      />
      <p className="text-center text-[12.5px] text-[#8B95A6]">
        You&apos;ll be redirected to Stripe to enter card details.
      </p>
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

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function passthroughParams(params: Record<string, string | string[] | undefined>): string {
  const out = new URLSearchParams();
  for (const key of ["plan", "cadence", "currency"] as const) {
    const value = params[key];
    if (typeof value === "string" && value) out.set(key, value);
  }
  return out.toString();
}

function parsePlan(value: string | string[] | undefined): Plan | undefined {
  const v = single(value);
  if (v === Plan.STUDIO || v === Plan.AGENCY || v === Plan.NETWORK) return v;
  return undefined;
}

function parseCadence(value: string | string[] | undefined): BillingCadence | undefined {
  const v = single(value);
  if (v === BillingCadence.MONTHLY || v === BillingCadence.ANNUAL) return v;
  return undefined;
}
