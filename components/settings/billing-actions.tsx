"use client";

import { useState, useTransition } from "react";
import { Plan } from "@/lib/enums";
import { PLAN_ORDER, PLAN_DISPLAY } from "@/lib/plans";
import { CURRENCY_META, SUPPORTED_CURRENCIES, type SupportedCurrency } from "@/lib/currencies";
import {
  cancelSubscriptionAction,
  createCheckoutSessionAction,
  createPortalSessionAction,
  updatePreferredCurrencyAction,
} from "@/app/(dashboard)/settings/billing/actions";

const ACCENT = "#3A5BA0";
const ACCENT_ON_DARK = "#8FAEE0";
const DARK_MUTED = "#a9b8d4";

/**
 * Client island for the billing card. When the agency has an active sub
 * we render Manage-subscription (opens Stripe Portal, mainly for card
 * updates) + an in-app Cancel affordance with a two-step confirm. When
 * there's no sub we show upgrade CTAs that kick off a hosted Checkout.
 * A currency picker sits underneath either surface. Renders on the dark
 * plan card in the revamp layout, so all controls carry dark-surface
 * styling (white-on-dark text, rgba borders).
 *
 * The Cancel button is suppressed when `hasScheduledCancel` is already
 * true — that state is already surfaced by SubscriptionStatusCard along
 * with a Resume button, and offering a second "Cancel" is nonsensical.
 */
export function BillingActions({
  currentPlan,
  hasSubscription,
  hasScheduledCancel,
  currency: initialCurrency,
}: {
  currentPlan: Plan;
  hasSubscription: boolean;
  hasScheduledCancel: boolean;
  currency: SupportedCurrency;
}) {
  const [pending, startTransition] = useTransition();
  const [currencyPending, startCurrencyTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState<SupportedCurrency>(initialCurrency);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

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

  const goCancel = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await cancelSubscriptionAction();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        window.location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't cancel subscription.");
      }
    });
  };

  return (
    <div className="flex flex-col items-end" style={{ gap: 10 }}>
      {hasSubscription ? (
        <div className="flex flex-col items-end" style={{ gap: 8 }}>
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
            {pending && !confirmingCancel ? "Loading…" : "Manage subscription"}
          </button>
          {!hasScheduledCancel ? (
            confirmingCancel ? (
              <div
                className="flex flex-col items-end"
                style={{
                  gap: 8,
                  background: "rgba(255,255,255,0.06)",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.15)",
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    color: "#e4e9f1",
                    lineHeight: 1.4,
                    textAlign: "right",
                    maxWidth: 240,
                  }}
                >
                  Your plan stays active until the end of the current period. You can resume any
                  time before then.
                </span>
                <div className="flex" style={{ gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => setConfirmingCancel(false)}
                    disabled={pending}
                    style={{
                      background: "transparent",
                      color: DARK_MUTED,
                      fontWeight: 600,
                      fontSize: 12.5,
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "1px solid rgba(255,255,255,0.20)",
                      fontFamily: "inherit",
                      cursor: pending ? "wait" : "pointer",
                    }}
                  >
                    Keep it
                  </button>
                  <button
                    type="button"
                    onClick={goCancel}
                    disabled={pending}
                    style={{
                      background: "#A02B1C",
                      color: "#ffffff",
                      fontWeight: 700,
                      fontSize: 12.5,
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "none",
                      fontFamily: "inherit",
                      cursor: pending ? "wait" : "pointer",
                    }}
                  >
                    {pending ? "Canceling…" : "Yes, cancel"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingCancel(true)}
                disabled={pending}
                style={{
                  background: "transparent",
                  color: DARK_MUTED,
                  fontSize: 12.5,
                  fontWeight: 500,
                  padding: "4px 8px",
                  borderRadius: 6,
                  border: "none",
                  textDecoration: "underline",
                  textUnderlineOffset: 3,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                Cancel subscription
              </button>
            )
          ) : null}
        </div>
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
