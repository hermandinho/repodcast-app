"use client";

import { useState, useTransition } from "react";
import { Plan } from "@/lib/enums";
import { PLAN_ORDER, PLAN_DISPLAY } from "@/lib/plans";
import { CURRENCY_META, SUPPORTED_CURRENCIES, type SupportedCurrency } from "@/lib/currencies";
import {
  createCheckoutSessionAction,
  createPortalSessionAction,
  updatePreferredCurrencyAction,
} from "@/app/(dashboard)/settings/billing/actions";

const ACCENT = "#3A5BA0";
const ACCENT_ON_DARK = "#8FAEE0";
const DARK_MUTED = "#a9b8d4";

/**
 * Client island for the billing card. Renders either "Manage subscription"
 * (existing customer) or upgrade/downgrade buttons, plus a currency picker.
 * Renders on the dark plan card in the revamp layout, so all controls
 * carry dark-surface styling (white-on-dark text, rgba borders).
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
    <div className="flex flex-col items-end" style={{ gap: 10 }}>
      {hasSubscription ? (
        <button
          type="button"
          onClick={goPortal}
          disabled={pending}
          style={{
            background: ACCENT,
            color: "#ffffff",
            fontWeight: 600,
            fontSize: 13.5,
            padding: "10px 18px",
            borderRadius: 8,
            border: "none",
            fontFamily: "inherit",
            cursor: pending ? "wait" : "pointer",
            opacity: pending ? 0.7 : 1,
          }}
        >
          {pending ? "Loading…" : "Manage subscription"}
        </button>
      ) : (
        <div className="flex flex-wrap" style={{ gap: 8 }}>
          {PLAN_ORDER.filter((p) => p !== currentPlan).map((p) => {
            const isPrimary = p === Plan.STUDIO || p === Plan.NETWORK;
            return (
              <button
                key={p}
                type="button"
                onClick={() => goCheckout(p)}
                disabled={pending}
                style={{
                  background: isPrimary ? ACCENT : "transparent",
                  color: isPrimary ? "#ffffff" : DARK_MUTED,
                  fontWeight: 600,
                  fontSize: 13.5,
                  padding: "9px 16px",
                  borderRadius: 8,
                  border: isPrimary ? "none" : "1px solid rgba(255,255,255,0.20)",
                  fontFamily: "inherit",
                  cursor: pending ? "wait" : "pointer",
                }}
              >
                {pending ? "Loading…" : `Upgrade to ${PLAN_DISPLAY[p].name}`}
              </button>
            );
          })}
        </div>
      )}

      <label
        className="inline-flex items-center"
        style={{ gap: 8, fontSize: 12.5, color: DARK_MUTED }}
      >
        <span>Currency</span>
        <select
          value={currency}
          onChange={(e) => onCurrencyChange(e.target.value as SupportedCurrency)}
          disabled={currencyPending}
          style={{
            background: "transparent",
            color: "#ffffff",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 7,
            padding: "5px 10px",
            fontSize: 12.5,
            fontFamily: "inherit",
            outline: "none",
          }}
        >
          {SUPPORTED_CURRENCIES.map((c) => (
            <option key={c} value={c} style={{ color: "#1A2A4A" }}>
              {CURRENCY_META[c].symbol} {c}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <div
          style={{
            fontSize: 12,
            color: ACCENT_ON_DARK,
            background: "rgba(255,255,255,0.06)",
            padding: "6px 10px",
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
