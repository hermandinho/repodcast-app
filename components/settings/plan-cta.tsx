"use client";

import { useState, useTransition } from "react";
import { Plan } from "@/lib/enums";
import { PLAN_DISPLAY, PLAN_ORDER } from "@/lib/plans";
import type { SupportedCurrency } from "@/lib/currencies";
import {
  changePlanAction,
  createCheckoutSessionAction,
} from "@/app/(dashboard)/settings/billing/actions";

/**
 * The CTA button rendered inside each `PlanTile` on /settings/billing.
 * Same tile chrome as before; the interactive routing lives here so the
 * plan-grid CTAs actually do something (they used to be a plain `<div>`).
 *
 * Routing:
 *   - Current plan → non-interactive pill.
 *   - Has subscription (paid or trialing) → `changePlanAction` for an
 *     in-place plan swap. Trialing subs get `trial_end: 'now'` so the
 *     new plan charges immediately.
 *   - No subscription → `createCheckoutSessionAction`, i.e. fresh hosted
 *     Stripe Checkout (covers post-cancel / post-expired flows).
 */
export function PlanCTA({
  plan,
  currentPlan,
  isCurrent,
  hasSubscription,
  currency,
}: {
  plan: Plan;
  currentPlan: Plan;
  isCurrent: boolean;
  hasSubscription: boolean;
  currency: SupportedCurrency;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Upgrade vs downgrade is derived from PLAN_ORDER (Solo → Studio → Network),
  // so labels stay correct if we ever reshuffle tiers.
  const tileRank = PLAN_ORDER.indexOf(plan);
  const currentRank = PLAN_ORDER.indexOf(currentPlan);
  const label = isCurrent
    ? "Your plan"
    : !hasSubscription
      ? `Choose ${PLAN_DISPLAY[plan].name}`
      : tileRank > currentRank
        ? `Upgrade to ${PLAN_DISPLAY[plan].name}`
        : `Downgrade to ${PLAN_DISPLAY[plan].name}`;

  const ACCENT = "#3A5BA0";
  const ACCENT_SOFT = "#eef2fb";
  const INK = "#0a1e3c";
  const MUTED = "#41506b";

  const bg = isCurrent ? ACCENT_SOFT : plan === Plan.NETWORK ? INK : "transparent";
  const color = isCurrent ? ACCENT : plan === Plan.NETWORK ? "#fff" : MUTED;
  const border = isCurrent || plan === Plan.NETWORK ? "none" : "1px solid #d4dbe7";

  if (isCurrent) {
    return (
      <div
        className="text-center"
        style={{
          background: bg,
          color,
          border,
          borderRadius: 8,
          padding: "9px",
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        {label}
      </div>
    );
  }

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        // Existing subscription (paid or trialing) → in-place swap.
        // No sub (post-cancel / post-expired) → hosted Checkout.
        if (hasSubscription) {
          const result = await changePlanAction({ plan });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          // Trial-upgrade path charges immediately — reload so the trial
          // pill flips + the new limits reflect. The webhook writes
          // trialStatus=CONVERTED shortly after; a refresh picks it up.
          window.location.reload();
        } else {
          const result = await createCheckoutSessionAction({ plan, currency });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          window.location.href = result.data.url;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Plan change failed.");
      }
    });
  };

  return (
    <div className="flex flex-col" style={{ gap: 6 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="text-center"
        style={{
          background: bg,
          color,
          border,
          borderRadius: 8,
          padding: "9px",
          fontWeight: 600,
          fontSize: 13,
          fontFamily: "inherit",
          cursor: pending ? "wait" : "pointer",
          opacity: pending ? 0.7 : 1,
        }}
      >
        {pending ? "Working…" : label}
      </button>
      {error ? (
        <div
          style={{
            fontSize: 11.5,
            color: "#A02B1C",
            lineHeight: 1.35,
            textAlign: "center",
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
