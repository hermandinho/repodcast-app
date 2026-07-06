"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BillingCadence, Plan } from "@/lib/enums";
import {
  CURRENCY_META,
  DEFAULT_CURRENCY,
  formatPlanPrice,
  SUPPORTED_CURRENCIES,
  type SupportedCurrency,
} from "@/lib/currencies";
import { PLAN_DISPLAY, PLAN_ORDER, TRIAL_DAYS, effectiveMonthlyPrice, priceFor } from "@/lib/plans";

/**
 * Public plan picker — powers `/pricing` AND is re-mounted inside
 * `/onboarding/plan` (with `kind="onboarding"`) so the two surfaces share
 * the exact same layout + math. Purely presentational: the "Start trial"
 * CTAs on `/pricing` link to the sign-up flow, and the `/onboarding/plan`
 * variant posts to a server action instead.
 *
 * Revamp visual system (see `ref/UI/Revamp/`): three plan cards, STUDIO
 * gets a dark navy background with white text + a floating "POPULAR"
 * badge above the card and a shadow that lifts it off the row. Solo /
 * Network sit in white cards with a subtle border. CTAs pin to the
 * bottom of each card via `margin-top: auto` for consistent alignment.
 */

const INK = "#0a1e3c";
const ACCENT = "#3A5BA0";
const MUTED = "#41506b";
const LIGHT_MUTED = "#8a97ad";
const OUTLINE = "#e4e9f1";
const OUTLINE_STRONG = "#d4dbe7";
const PANEL_BG = "#eef1f6";
const GREEN_TAG_BG = "#e4f3ec";
const GREEN_TAG_INK = "#1f8a5b";

type Mode =
  | { kind: "public"; trialEligible: boolean }
  | {
      kind: "onboarding";
      submit: (formData: FormData) => Promise<void>;
      initialPlan?: Plan;
      initialCadence?: BillingCadence;
      initialCurrency?: SupportedCurrency;
      submittingLabel?: string;
      trialEligible: boolean;
    };

export function PricingPicker(
  props: Partial<Mode> & { trialEligible?: boolean } = { kind: "public", trialEligible: true },
) {
  const trialEligible = props.trialEligible ?? true;
  const mode: Mode =
    props.kind === "onboarding"
      ? {
          kind: "onboarding",
          submit: props.submit!,
          initialPlan: props.initialPlan,
          initialCadence: props.initialCadence,
          initialCurrency: props.initialCurrency,
          submittingLabel: props.submittingLabel,
          trialEligible,
        }
      : { kind: "public", trialEligible };

  const [cadence, setCadence] = useState<BillingCadence>(
    mode.kind === "onboarding" ? (mode.initialCadence ?? "MONTHLY") : "MONTHLY",
  );
  const [currency, setCurrency] = useState<SupportedCurrency>(
    mode.kind === "onboarding" ? (mode.initialCurrency ?? DEFAULT_CURRENCY) : DEFAULT_CURRENCY,
  );

  return (
    <div className="flex flex-col" style={{ fontFamily: "var(--font-revamp-sans)" }}>
      {/* Controls row — cadence toggle + currency picker */}
      <div
        className="flex flex-wrap items-center justify-center"
        style={{ gap: 18, marginTop: 30 }}
      >
        <CadenceToggle value={cadence} onChange={setCadence} />
        <CurrencyPicker value={currency} onChange={setCurrency} />
      </div>

      {/* Plan cards — 3 equal columns, allow the popular badge (which sits
          -11px above the card) to render outside the row via the grid's
          top margin. */}
      <div
        className="grid grid-cols-1 md:grid-cols-3"
        style={{ gap: 18, marginTop: 34, alignItems: "stretch" }}
      >
        {PLAN_ORDER.map((plan) => (
          <PlanCard
            key={plan}
            plan={plan}
            cadence={cadence}
            currency={currency}
            mode={mode}
            highlighted={plan === Plan.STUDIO}
          />
        ))}
      </div>

      {/* Trust footer under the cards */}
      <div
        className="flex flex-wrap items-center justify-center"
        style={{ gap: 8, marginTop: 18, fontSize: 12.5, color: LIGHT_MUTED }}
      >
        <span
          aria-hidden
          style={{ width: 6, height: 6, borderRadius: 99, background: "#8fd0a8" }}
        />
        Secure checkout — you&apos;ll be redirected to Stripe to enter card details.
      </div>
    </div>
  );
}

function CadenceToggle({
  value,
  onChange,
}: {
  value: BillingCadence;
  onChange: (v: BillingCadence) => void;
}) {
  const active = "MONTHLY" === value ? "MONTHLY" : "ANNUAL";
  return (
    <div
      role="tablist"
      aria-label="Billing cadence"
      className="inline-flex items-center"
      style={{ background: PANEL_BG, borderRadius: 99, padding: 3 }}
    >
      {(["MONTHLY", "ANNUAL"] as const).map((v) => {
        const isActive = active === v;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(v)}
            className="inline-flex items-center transition-colors"
            style={{
              fontSize: 13.5,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? "#fff" : MUTED,
              background: isActive ? INK : "transparent",
              padding: "8px 20px",
              borderRadius: 99,
              gap: 7,
              border: "none",
              cursor: "pointer",
            }}
          >
            {v === "MONTHLY" ? "Monthly" : "Annual"}
            {v === "ANNUAL" ? (
              <span
                style={{
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: isActive ? "#fff" : GREEN_TAG_INK,
                  background: isActive ? "rgba(255,255,255,0.18)" : GREEN_TAG_BG,
                  padding: "2px 8px",
                  borderRadius: 99,
                  letterSpacing: "0.02em",
                }}
              >
                SAVE 2 MO
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function CurrencyPicker({
  value,
  onChange,
}: {
  value: SupportedCurrency;
  onChange: (v: SupportedCurrency) => void;
}) {
  return (
    <label
      className="inline-flex items-center"
      style={{ gap: 8, fontSize: 13, color: LIGHT_MUTED }}
    >
      <span>Currency</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SupportedCurrency)}
        style={{
          border: `1px solid ${OUTLINE_STRONG}`,
          borderRadius: 8,
          padding: "7px 12px",
          fontSize: 13,
          color: INK,
          background: "#fff",
          fontFamily: "inherit",
        }}
      >
        {SUPPORTED_CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {CURRENCY_META[c].code} — {CURRENCY_META[c].symbol}
          </option>
        ))}
      </select>
    </label>
  );
}

function PlanCard({
  plan,
  cadence,
  currency,
  mode,
  highlighted,
}: {
  plan: Plan;
  cadence: BillingCadence;
  currency: SupportedCurrency;
  mode: Mode;
  highlighted: boolean;
}) {
  const meta = PLAN_DISPLAY[plan];
  const shownPrice = useMemo(
    () => effectiveMonthlyPrice(plan, currency, cadence),
    [plan, currency, cadence],
  );
  const annualPrice = priceFor(plan, currency, "ANNUAL");
  const monthlyPrice = priceFor(plan, currency, "MONTHLY");
  const priceLabel = formatPlanPrice(Math.round(shownPrice), currency);
  const cadenceHint =
    cadence === "ANNUAL"
      ? `Billed ${formatPlanPrice(annualPrice, currency)} yearly`
      : "Billed monthly";
  // Trial framing is SOLO-only — Studio/Network buyers subscribe directly.
  // The trial-eligibility flag from the parent still gates on "first-time
  // customer" (no stripeCustomerId + trialStatus === NONE); we additionally
  // gate on the plan here so the picker shows the same message the server
  // action will honor. See MarketingStrategy.md §1 + `checkoutFromOnboardingAction`.
  const showTrialFraming = mode.trialEligible && plan === Plan.SOLO;
  const trialLine = showTrialFraming
    ? `$1 today, then ${formatPlanPrice(monthlyPrice, currency)}/mo after ${TRIAL_DAYS} days`
    : cadenceHint;

  // Dark navy for the popular (STUDIO) card; light card for the rest.
  const cardBg = highlighted ? INK : "#ffffff";
  const cardBorder = highlighted ? "none" : `1px solid ${OUTLINE}`;
  const cardShadow = highlighted
    ? "0 24px 52px -22px rgba(10,30,60,.45)"
    : "0 1px 2px rgba(10,30,60,0.04)";
  const nameColor = highlighted ? "#fff" : INK;
  const taglineColor = highlighted ? "#a9b8d4" : LIGHT_MUTED;
  const priceColor = highlighted ? "#fff" : INK;
  const perColor = highlighted ? "#a9b8d4" : LIGHT_MUTED;
  const microcopyColor = highlighted ? "#5c6f92" : "#b0bacb";
  const bulletBorder = highlighted ? "rgba(255,255,255,0.14)" : "#eef1f6";
  const bulletColor = highlighted ? "#dbe4f5" : MUTED;

  // Only Solo shows the trial CTA — Studio/Network go straight to
  // subscription. The parent-supplied `submittingLabel` (onboarding
  // fallback) is intentionally ignored on Studio/Network so we don't
  // leak trial copy onto non-trial cards; Solo still honors it.
  const ctaLabel = showTrialFraming
    ? `Start ${TRIAL_DAYS}-day trial`
    : mode.kind === "public"
      ? "Get started"
      : `Continue with ${meta.name}`;
  const overrideLabel =
    mode.kind === "onboarding" && showTrialFraming ? mode.submittingLabel : undefined;

  const ctaStyle: React.CSSProperties = {
    display: "block",
    textAlign: "center",
    borderRadius: 9,
    // Ref: outlined CTAs use 11px all-sides; filled uses 12px. The 1px
    // extra on the filled variant compensates for the missing border so
    // buttons visually align at the row baseline.
    padding: highlighted ? 12 : 11,
    fontWeight: 600,
    fontSize: 14,
    background: highlighted ? ACCENT : "#fff",
    color: highlighted ? "#fff" : INK,
    border: highlighted ? "none" : `1px solid ${OUTLINE_STRONG}`,
    width: "100%",
    fontFamily: "inherit",
    cursor: "pointer",
    lineHeight: 1.2,
  };

  return (
    <div
      className="relative flex flex-col p-[22px] sm:p-[26px] md:p-[28px]"
      style={{
        background: cardBg,
        border: cardBorder,
        boxShadow: cardShadow,
        borderRadius: 14,
      }}
    >
      {highlighted ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: -11,
            left: "50%",
            transform: "translateX(-50%)",
            background: ACCENT,
            color: "#fff",
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.08em",
            padding: "4px 12px",
            borderRadius: 99,
            fontFamily: "var(--font-revamp-sans)",
          }}
        >
          POPULAR
        </span>
      ) : null}

      <div style={{ fontSize: 16, fontWeight: 700, color: nameColor }}>{meta.name}</div>
      <div style={{ fontSize: 12.5, color: taglineColor, marginTop: 3 }}>{meta.tagline}</div>

      <div style={{ marginTop: 20 }}>
        <span
          className="text-[34px] sm:text-[38px] md:text-[40px]"
          style={{
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: priceColor,
            lineHeight: 1,
          }}
        >
          {priceLabel}
        </span>
        <span style={{ fontSize: 14, color: perColor, marginLeft: 4 }}>/mo</span>
      </div>
      <div style={{ fontSize: 12, color: microcopyColor, marginTop: 6 }}>{trialLine}</div>

      <div
        style={{
          borderTop: `1px solid ${bulletBorder}`,
          margin: "20px 0",
          paddingTop: 16,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          fontSize: 13.5,
          color: bulletColor,
        }}
      >
        {meta.highlights.map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>

      {mode.kind === "public" ? (
        <Link
          href={buildSignUpHref(plan, cadence, currency)}
          className="no-underline"
          style={{ ...ctaStyle, marginTop: "auto" }}
        >
          {overrideLabel ?? ctaLabel}
        </Link>
      ) : (
        <form action={mode.submit} style={{ marginTop: "auto" }}>
          <input type="hidden" name="plan" value={plan} />
          <input type="hidden" name="cadence" value={cadence} />
          <input type="hidden" name="currency" value={currency} />
          <button type="submit" style={ctaStyle}>
            {overrideLabel ?? ctaLabel}
          </button>
        </form>
      )}
    </div>
  );
}

function buildSignUpHref(plan: Plan, cadence: BillingCadence, currency: SupportedCurrency): string {
  // The pre-selection travels through Clerk's redirect_url so /onboarding/plan
  // can highlight the right tile after sign-up. Clerk unescapes redirect_url
  // exactly once.
  const dest = new URLSearchParams({ plan, cadence, currency });
  const redirectTo = `/onboarding/plan?${dest.toString()}`;
  const signUp = new URLSearchParams({ redirect_url: redirectTo });
  return `/sign-up?${signUp.toString()}`;
}
