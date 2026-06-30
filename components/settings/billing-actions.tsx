"use client";

import { useState, useTransition } from "react";
import { Plan } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { PLAN_ORDER, PLAN_DISPLAY } from "@/lib/plans";
import { CURRENCY_META, SUPPORTED_CURRENCIES, type SupportedCurrency } from "@/lib/currencies";
import {
  createCheckoutSessionAction,
  createPortalSessionAction,
  updatePreferredCurrencyAction,
} from "@/app/(dashboard)/settings/billing/actions";

/**
 * Client island for the billing card. Renders either "Manage subscription"
 * (existing customer) or upgrade/downgrade buttons, plus a currency picker
 * that updates the agency's preferredCurrency and reloads so the plan
 * cards reflect the new prices.
 */
export function BillingActions({
  currentPlan,
  hasSubscription,
  currency: initialCurrency,
}: {
  currentPlan: Plan;
  hasSubscription: boolean;
  currency: SupportedCurrency;
}) {
  const [pending, startTransition] = useTransition();
  const [currencyPending, startCurrencyTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Optimistic local state — the page is server-rendered, so we reload on
  // success to refresh the prices everywhere. Keeping the local copy means
  // the picker doesn't flash back to the old value during the round-trip.
  const [currency, setCurrency] = useState<SupportedCurrency>(initialCurrency);

  const onCurrencyChange = (next: SupportedCurrency) => {
    if (next === currency) return;
    const previous = currency;
    setCurrency(next);
    setError(null);
    startCurrencyTransition(async () => {
      try {
        const result = await updatePreferredCurrencyAction({ currency: next });
        if (!result.ok) {
          setCurrency(previous);
          setError(result.error);
          return;
        }
        // Server revalidates /settings/billing; a hard reload picks up the
        // re-rendered prices + active-plan summary in one shot.
        window.location.reload();
      } catch (err) {
        setCurrency(previous);
        setError(err instanceof Error ? err.message : "Couldn't save currency.");
      }
    });
  };

  const goCheckout = (plan: Plan) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createCheckoutSessionAction({ plan, currency });
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
        <label className="flex items-center gap-2 text-[12px] text-[#5A6473]">
          <span className="text-[10.5px] font-semibold tracking-wide text-[#8B95A6] uppercase">
            Currency
          </span>
          <select
            value={currency}
            onChange={(e) => onCurrencyChange(e.target.value as SupportedCurrency)}
            disabled={currencyPending}
            className="rounded-[8px] border border-[#C9D4E8] bg-white px-2 py-1 text-[12.5px] text-[#1A2A4A] outline-none"
          >
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {CURRENCY_META[c].symbol} {c}
              </option>
            ))}
          </select>
        </label>
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
