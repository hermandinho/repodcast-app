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
import { PLAN_DISPLAY, PLAN_ORDER, effectiveMonthlyPrice, priceFor } from "@/lib/plans";

/**
 * Public plan picker — powers /pricing AND is re-mounted inside
 * /onboarding/plan (with `mode="onboarding"`) so the two surfaces share
 * the exact same layout + math. Purely presentational: the "Get Started"
 * CTAs on /pricing link to the sign-up flow, and the /onboarding/plan
 * variant posts to a server action instead.
 */

type Mode =
  | { kind: "public" }
  | {
      kind: "onboarding";
      /** Server action rendered as a form target; passed via `<form action>`. */
      submit: (formData: FormData) => Promise<void>;
      /** Optional query params to pre-select from the URL. */
      initialPlan?: Plan;
      initialCadence?: BillingCadence;
      initialCurrency?: SupportedCurrency;
      submittingLabel?: string;
    };

export function PricingPicker(props: Partial<Mode> = { kind: "public" }) {
  const mode: Mode =
    props.kind === "onboarding"
      ? {
          kind: "onboarding",
          submit: props.submit!,
          initialPlan: props.initialPlan,
          initialCadence: props.initialCadence,
          initialCurrency: props.initialCurrency,
          submittingLabel: props.submittingLabel,
        }
      : { kind: "public" };

  const [cadence, setCadence] = useState<BillingCadence>(
    mode.kind === "onboarding" ? (mode.initialCadence ?? "MONTHLY") : "MONTHLY",
  );
  const [currency, setCurrency] = useState<SupportedCurrency>(
    mode.kind === "onboarding" ? (mode.initialCurrency ?? DEFAULT_CURRENCY) : DEFAULT_CURRENCY,
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-center gap-4">
        <CadenceToggle value={cadence} onChange={setCadence} />
        <CurrencyPicker value={currency} onChange={setCurrency} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {PLAN_ORDER.map((plan) => (
          <PlanCard
            key={plan}
            plan={plan}
            cadence={cadence}
            currency={currency}
            mode={mode}
            highlighted={plan === Plan.AGENCY}
          />
        ))}
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
  return (
    <div
      role="tablist"
      aria-label="Billing cadence"
      className="inline-flex items-center rounded-full bg-white/80 p-1 text-[13px] font-medium shadow-sm ring-1 ring-black/5"
    >
      <button
        type="button"
        role="tab"
        aria-selected={value === "MONTHLY"}
        onClick={() => onChange("MONTHLY")}
        className={
          "rounded-full px-4 py-1.5 transition-colors " +
          (value === "MONTHLY" ? "bg-[#1A2A4A] text-white" : "text-[#5B6A85] hover:text-[#1A2A4A]")
        }
      >
        Monthly
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "ANNUAL"}
        onClick={() => onChange("ANNUAL")}
        className={
          "rounded-full px-4 py-1.5 transition-colors " +
          (value === "ANNUAL" ? "bg-[#1A2A4A] text-white" : "text-[#5B6A85] hover:text-[#1A2A4A]")
        }
      >
        Annual
        <span
          className={
            "ml-1.5 rounded-full px-1.5 py-0.5 text-[10.5px] " +
            (value === "ANNUAL" ? "bg-white/20 text-white" : "bg-[#E6F1EA] text-[#1E7A47]")
          }
        >
          Save 2 mo
        </span>
      </button>
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
    <label className="inline-flex items-center gap-2 text-[13px]">
      <span className="text-[#5B6A85]">Currency</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SupportedCurrency)}
        className="rounded-md border border-black/10 bg-white/80 px-2 py-1 text-[13px]"
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
  const priceLabel = formatPlanPrice(Math.round(shownPrice), currency);
  const perLabel = "/mo";
  const cadenceHint =
    cadence === "ANNUAL"
      ? `Billed ${formatPlanPrice(annualPrice, currency)} yearly`
      : "Billed monthly";

  return (
    <div
      className={
        "flex flex-col rounded-2xl bg-white/90 p-6 shadow-sm ring-1 " +
        (highlighted ? "ring-[#1A2A4A]" : "ring-black/5")
      }
    >
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-[19px] font-semibold">{meta.name}</h3>
        {highlighted ? (
          <span className="rounded-full bg-[#1A2A4A] px-2 py-0.5 text-[10.5px] font-semibold tracking-wider text-white uppercase">
            Popular
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-[13px] text-[#5B6A85]">{meta.tagline}</p>

      <div className="mt-5 flex items-baseline gap-1">
        <span className="font-display text-[32px] font-semibold tracking-tight">{priceLabel}</span>
        <span className="text-[13px] text-[#5B6A85]">{perLabel}</span>
      </div>
      <div className="mt-1 text-[11.5px] text-[#8B95A6]">{cadenceHint}</div>

      <ul className="mt-5 flex flex-col gap-2 text-[13.5px] text-[#1A2A4A]">
        {meta.highlights.map((h) => (
          <li key={h} className="flex items-start gap-2">
            <span className="mt-2 h-[5px] w-[5px] flex-shrink-0 rounded-full bg-[#1A2A4A]" />
            {h}
          </li>
        ))}
      </ul>

      <div className="mt-6 flex-1" />

      {mode.kind === "public" ? (
        <Link
          href={buildSignUpHref(plan, cadence, currency)}
          className={
            "inline-flex items-center justify-center rounded-full px-5 py-2.5 text-[13.5px] font-semibold transition-colors " +
            (highlighted
              ? "bg-[#1A2A4A] text-white hover:bg-[#0F1D3B]"
              : "bg-[#1A2A4A]/10 text-[#1A2A4A] hover:bg-[#1A2A4A]/20")
          }
        >
          Get Started
        </Link>
      ) : (
        <form action={mode.submit}>
          <input type="hidden" name="plan" value={plan} />
          <input type="hidden" name="cadence" value={cadence} />
          <input type="hidden" name="currency" value={currency} />
          <button
            type="submit"
            className={
              "w-full rounded-full px-5 py-2.5 text-[13.5px] font-semibold transition-colors " +
              (highlighted
                ? "bg-[#1A2A4A] text-white hover:bg-[#0F1D3B]"
                : "bg-[#1A2A4A]/10 text-[#1A2A4A] hover:bg-[#1A2A4A]/20")
            }
          >
            {mode.submittingLabel ?? `Continue with ${meta.name}`}
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
