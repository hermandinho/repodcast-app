import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { BillingCadence, Plan } from "@/lib/enums";
import { OnboardingStepHeader } from "@/components/onboarding/onboarding-step-header";
import { PlanComparisonTable } from "@/components/pricing/plan-comparison-table";
import { PricingPicker } from "@/components/pricing/pricing-picker";
import { asSupportedCurrency, DEFAULT_CURRENCY } from "@/lib/currencies";
import { TRIAL_DAYS } from "@/lib/plans";
import { prisma } from "@/server/db/client";
import { isLiveDb } from "@/server/data/source";
import { getOnboardingStateForUser } from "@/server/db/agencies";
import { checkoutFromOnboardingAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Step 2: pick a plan → Stripe Checkout.
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

  let trialEligible = true;
  if (isLiveDb()) {
    const { userId } = await auth();
    if (!userId) redirect("/sign-in?redirect_url=%2Fonboarding%2Fplan");
    const state = await getOnboardingStateForUser(userId);
    if (state.kind === "no-membership") redirect(`/onboarding/workspace${suffix}`);
    if (state.kind === "paying") redirect("/dashboard");
    // Trial is one-per-Stripe-customer. Mirrors the check in
    // `checkoutFromOnboardingAction` so the CTA copy matches what actually
    // happens at Stripe.
    if (state.kind === "no-subscription") {
      const agency = await prisma.agency.findUnique({
        where: { id: state.agencyId },
        select: { stripeCustomerId: true, trialStatus: true },
      });
      trialEligible = !agency?.stripeCustomerId && (agency?.trialStatus ?? "NONE") === "NONE";
    }
  }

  // Trial-eligible visitors default to STUDIO — the middle tier, our primary
  // ICP (small teams + studios). Solo users can drop down, Network users can
  // upgrade up. Returning customers keep whatever they were pre-selecting or
  // picked previously.
  const initialPlan = parsePlan(params.plan) ?? (trialEligible ? Plan.STUDIO : undefined);
  const initialCadence = parseCadence(params.cadence);
  const initialCurrency = asSupportedCurrency(single(params.currency)) ?? DEFAULT_CURRENCY;

  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      <OnboardingStepHeader
        step="plan"
        title={trialEligible ? "Start your 7-day trial" : "Choose a plan"}
        subtitle={
          trialEligible
            ? `$1 activation fee today, then your plan starts on day ${TRIAL_DAYS + 1}. Cancel any time from Settings → Billing — the $1 is non-refundable.`
            : "Pay by card via Stripe. Annual saves you two months. Switch or cancel any time from Settings → Billing."
        }
      />

      <PricingPicker
        kind="onboarding"
        submit={checkoutFromOnboardingAction}
        initialPlan={initialPlan}
        initialCadence={initialCadence}
        initialCurrency={initialCurrency}
        submittingLabel={
          trialEligible ? `Start ${TRIAL_DAYS}-day trial · $1 today` : "Continue to checkout"
        }
        trialEligible={trialEligible}
      />
      <p className="text-center text-[12.5px] text-[#8B95A6]">
        You&apos;ll be redirected to Stripe to enter card details.
      </p>

      <div className="mt-2">
        <PlanComparisonTable compact />
      </div>
    </div>
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
  if (v === Plan.SOLO || v === Plan.STUDIO || v === Plan.NETWORK) return v;
  return undefined;
}

function parseCadence(value: string | string[] | undefined): BillingCadence | undefined {
  const v = single(value);
  if (v === BillingCadence.MONTHLY || v === BillingCadence.ANNUAL) return v;
  return undefined;
}
