"use client";

import { useState, useTransition } from "react";
import { Plan } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { PLAN_ORDER, PLAN_DISPLAY } from "@/lib/plans";
import {
  createCheckoutSessionAction,
  createPortalSessionAction,
} from "@/app/(dashboard)/settings/billing/actions";

/**
 * Tiny client island for the billing card. Renders either "Manage
 * subscription" (existing customer) or upgrade/downgrade buttons.
 */
export function BillingActions({
  currentPlan,
  hasSubscription,
}: {
  currentPlan: Plan;
  hasSubscription: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const goCheckout = (plan: Plan) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createCheckoutSessionAction({ plan });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        window.location.href = result.data.url;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Checkout failed.");
      }
    });
  };

  const goPortal = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createPortalSessionAction();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        window.location.href = result.data.url;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Portal failed.");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {hasSubscription ? (
          <Button size="sm" onClick={goPortal} disabled={pending}>
            {pending ? "Loading…" : "Manage subscription"}
          </Button>
        ) : (
          PLAN_ORDER.filter((p) => p !== currentPlan).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={p === Plan.AGENCY ? "primary" : "secondary"}
              onClick={() => goCheckout(p)}
              disabled={pending}
            >
              {pending ? "Loading…" : `Upgrade to ${PLAN_DISPLAY[p].name}`}
            </Button>
          ))
        )}
      </div>
      {error && <div className="text-[12px] text-[#A06D12]">{error}</div>}
    </div>
  );
}
