"use client";

import { useState, useTransition } from "react";
import { resumeSubscriptionAction } from "@/app/(dashboard)/settings/billing/actions";

/**
 * Post-cancellation / cancel-scheduled banner on `/settings/billing`. Two
 * modes, one component so the styling stays consistent:
 *
 *   - **scheduled** — the sub is still active but Stripe will end it on
 *     `cancelAt`. We show the date and a "Resume subscription" button
 *     that calls `resumeSubscriptionAction` (flips
 *     `cancel_at_period_end` back to false, no reprice, no proration).
 *
 *   - **canceled** — the sub is fully gone (`stripeSubscriptionId === null`)
 *     but the agency has a `stripeCustomerId` from a prior Stripe run.
 *     No Resume button — Stripe won't reanimate a deleted sub; the user
 *     picks a plan tile below to start a fresh subscription against the
 *     same customer record.
 */
export function SubscriptionStatusCard({
  mode,
  cancelAt,
}: {
  mode: "scheduled" | "canceled";
  cancelAt: Date | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const dateLabel = cancelAt
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(cancelAt)
    : null;

  const onResume = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await resumeSubscriptionAction();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        window.location.reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Resume failed.");
      }
    });
  };

  const scheduled = mode === "scheduled";
  const headline = scheduled ? "Subscription is set to cancel" : "Subscription canceled";
  const body = scheduled
    ? dateLabel
      ? `Your plan stays active until ${dateLabel}. Resume before then to keep it going — no re-entry of card details, no proration.`
      : "Your plan stays active until the end of the current period. Resume any time before then."
    : "Your plan is gone and you're on the free SOLO tier. Pick a plan below to resubscribe — your payment method is still on file.";

  return (
    <div
      style={{
        background: "#ffffff",
        border: `1px solid ${scheduled ? "#EAD5A0" : "#e4c5c5"}`,
        borderRadius: 12,
        padding: "18px 24px",
        marginTop: 16,
      }}
    >
      <div className="flex flex-wrap items-start justify-between" style={{ gap: 16 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
            <span
              style={{
                fontSize: 15.5,
                fontWeight: 700,
                color: "#0a1e3c",
              }}
            >
              {headline}
            </span>
            <span
              className="rounded-full"
              style={{
                background: scheduled ? "#FDF1DC" : "#FBE7E4",
                color: scheduled ? "#7A5B1E" : "#A02B1C",
                padding: "3px 10px",
                fontFamily: "var(--font-revamp-mono)",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.04em",
              }}
            >
              {scheduled ? "ENDING SOON" : "CANCELED"}
            </span>
          </div>
          <p
            style={{
              fontSize: 13,
              color: "#41506b",
              marginTop: 6,
              lineHeight: 1.5,
            }}
          >
            {body}
          </p>
        </div>
        {scheduled ? (
          <div className="flex flex-col items-end" style={{ gap: 6 }}>
            <button
              type="button"
              onClick={onResume}
              disabled={pending}
              style={{
                background: "#3A5BA0",
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
              {pending ? "Resuming…" : "Resume subscription"}
            </button>
            {error ? (
              <div
                style={{
                  fontSize: 12,
                  color: "#A02B1C",
                  maxWidth: 260,
                  textAlign: "right",
                  lineHeight: 1.4,
                }}
              >
                {error}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
