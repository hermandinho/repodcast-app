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
  let ineligibleReason: "customer_exists" | "prior_trial" | null = null;
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
      const hasPriorCustomer = Boolean(agency?.stripeCustomerId);
      const hasPriorTrial = (agency?.trialStatus ?? "NONE") !== "NONE";
      trialEligible = !hasPriorCustomer && !hasPriorTrial;
      if (!trialEligible) {
        ineligibleReason = hasPriorTrial ? "prior_trial" : "customer_exists";
        // Log to help diagnose confusion where a user expects the trial CTA
        // but their agency has stale Stripe state from a prior attempt.
        console.log("[onboarding/plan] trial ineligible", {
          agencyId: state.agencyId,
          stripeCustomerId: agency?.stripeCustomerId,
          trialStatus: agency?.trialStatus,
        });
      }
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
    <div className="flex flex-col" style={{ gap: 40 }}>
      <OnboardingStepHeader
        step="plan"
        title="Choose your plan"
        subtitle={
          trialEligible
            ? `Solo comes with a 7-day trial for $1. Studio and Network start immediately at their monthly price. Cancel any time from Settings → Billing.`
            : ineligibleReason === "prior_trial"
              ? "You've used your Solo trial — every plan starts immediately at its monthly price. Cancel any time from Settings → Billing."
              : "Pay by card via Stripe. Annual saves you two months. Switch or cancel any time from Settings → Billing."
        }
      />

      {/* Anchor target for the sticky CTA row inside <PlanComparisonTable>. */}
      <div id="top-plans" style={{ scrollMarginTop: 80 }}>
        <PricingPicker
          kind="onboarding"
          submit={checkoutFromOnboardingAction}
          initialPlan={initialPlan}
          initialCadence={initialCadence}
          initialCurrency={initialCurrency}
          submittingLabel={`Start ${TRIAL_DAYS}-day trial`}
          trialEligible={trialEligible}
        />
      </div>

      <PlanComparisonTable compact />
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
