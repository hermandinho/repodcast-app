"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { OnboardingStep, Plan } from "@/lib/enums";
import { Input } from "@/components/ui/input";
import { track } from "@/lib/analytics/track-client";
import { PLAN_DISPLAY, PLAN_ORDER, planDisplayFor } from "@/lib/plans";
import { DEFAULT_CURRENCY, formatPlanPrice } from "@/lib/currencies";
import { createAgencyAction, setOnboardingStepAction } from "@/app/onboarding/actions";
import { inviteMemberAction } from "@/app/(dashboard)/settings/team/actions";
import { createClientAction } from "@/app/(dashboard)/clients/actions";

/**
 * Self-service onboarding wizard (Phase 1.0 → multi-step expansion).
 *
 * Three forward-only steps:
 *   1. Workspace — agency name + plan (commits via `createAgencyAction`).
 *   2. Teammates — optional invites (`inviteMemberAction` per row).
 *   3. First client — optional (`createClientAction`).
 *
 * Steps 2 and 3 are skippable. Phase 2.10 added persisted progress: after
 * each advance/skip/finish the wizard fires `setOnboardingStepAction`, and
 * the /onboarding gate redirects to /dashboard only once the persisted step
 * is `DONE`. So bailing mid-flow and signing back in resumes at the same
 * step — see `initialStep` prop.
 */
type Step = "workspace" | "teammates" | "client";
type InviteRow = { email: string; role: "admin" | "member" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Map a wizard step to the OnboardingStep enum value that means
// "the user just *finished* this step." The wizard writes this after a
// successful advance/skip, and writes DONE at the end of the funnel.
const STEP_COMPLETED_ENUM: Record<Step, OnboardingStep> = {
  workspace: OnboardingStep.TEAMMATES, // workspace done → resume at step 2
  teammates: OnboardingStep.CLIENT, //   teammates done → resume at step 3
  client: OnboardingStep.DONE, //        client done    → wizard finished
};

// When resuming, mark all earlier steps as completed so the stepper renders
// a checkmark on them — otherwise a user landing on step 3 would see step 2
// as "untouched."
const COMPLETED_BEFORE: Record<Step, Step[]> = {
  workspace: [],
  teammates: ["workspace"],
  client: ["workspace", "teammates"],
};

export function OnboardingWizard({
  suggestedAgencyName,
  initialStep = "workspace",
}: {
  suggestedAgencyName: string;
  initialStep?: Step;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialStep);
  const [completed, setCompleted] = useState<Set<Step>>(
    () => new Set(COMPLETED_BEFORE[initialStep]),
  );
  const [submitting, startSubmit] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Phase 2.10 — fire-and-forget step persistence. We never block the UI on
  // this; if the write fails, the next sign-in just resumes from the last
  // step that *did* land.
  const persistStep = (finishedStep: Step) => {
    void setOnboardingStepAction({ step: STEP_COMPLETED_ENUM[finishedStep] });
  };

  // Step 1
  const [agencyName, setAgencyName] = useState(suggestedAgencyName);
  const [plan, setPlan] = useState<Plan>(Plan.STUDIO);

  // Step 2
  const [invites, setInvites] = useState<InviteRow[]>([{ email: "", role: "member" }]);
  const [inviteErrors, setInviteErrors] = useState<Record<number, string>>({});

  // Step 3
  const [clientName, setClientName] = useState("");

  // Onboarding funnel — fire `onboarding_started` exactly once per mount,
  // and only when the wizard is actually starting from step 1. A user who
  // resumes mid-flow already fired this on the original visit.
  // Ref-gated so StrictMode's double-mount in dev doesn't double-fire.
  const startedFired = useRef(false);
  useEffect(() => {
    if (startedFired.current) return;
    if (initialStep !== "workspace") return;
    startedFired.current = true;
    track("onboarding_started", { suggestedAgencyName });
  }, [suggestedAgencyName, initialStep]);

  const advance = (next: Step) => {
    setError(null);
    setCompleted((prev) => new Set(prev).add(step));
    persistStep(step);
    setStep(next);
  };

  const finish = () => {
    setError(null);
    setCompleted((prev) => new Set(prev).add(step));
    persistStep(step);
    router.push("/dashboard");
  };

  /* --------------------------------------------------------------
     Step 1 — create workspace
     -------------------------------------------------------------- */

  const onCreateWorkspace = () => {
    setError(null);
    startSubmit(async () => {
      try {
        const result = await createAgencyAction({ agencyName, plan });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        track("agency_created", { agencyId: result.data.agencyId, plan });
        advance("teammates");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't create agency.");
      }
    });
  };

  /* --------------------------------------------------------------
     Step 2 — invite teammates (or skip)
     -------------------------------------------------------------- */

  const filledInvites = invites
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => row.email.trim().length > 0);

  const allInvitesValid = filledInvites.every(({ row }) => EMAIL_RE.test(row.email.trim()));

  const onSendInvites = () => {
    setError(null);
    setInviteErrors({});

    if (filledInvites.length === 0) {
      // Nothing to send — treat as skip.
      advance("client");
      return;
    }

    if (!allInvitesValid) {
      const errs: Record<number, string> = {};
      for (const { row, idx } of filledInvites) {
        if (!EMAIL_RE.test(row.email.trim())) errs[idx] = "Invalid email.";
      }
      setInviteErrors(errs);
      return;
    }

    startSubmit(async () => {
      const results = await Promise.allSettled(
        filledInvites.map(({ row }) =>
          inviteMemberAction({ email: row.email.trim(), role: row.role }),
        ),
      );

      const errs: Record<number, string> = {};
      let allOk = true;
      results.forEach((r, i) => {
        const idx = filledInvites[i].idx;
        if (r.status === "rejected") {
          errs[idx] = r.reason instanceof Error ? r.reason.message : "Failed.";
          allOk = false;
        } else if (!r.value.ok) {
          errs[idx] = r.value.error;
          allOk = false;
        }
      });
      setInviteErrors(errs);

      if (allOk) advance("client");
      else
        setError(
          "Some invites couldn't be sent. Fix the rows below or skip — you can invite from Settings → Team anytime.",
        );
    });
  };

  /* --------------------------------------------------------------
     Step 3 — first client (or skip)
     -------------------------------------------------------------- */

  const onCreateClient = () => {
    setError(null);
    const name = clientName.trim();
    if (!name) {
      finish(); // nothing entered → treat as skip
      return;
    }
    startSubmit(async () => {
      try {
        const result = await createClientAction({ name });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        finish();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't create client.");
      }
    });
  };

  /* --------------------------------------------------------------
     Render
     -------------------------------------------------------------- */

  return (
    <>
      <BrandHeader />

      <Card>
        <Stepper step={step} completed={completed} />

        {step === "workspace" && (
          <WorkspaceStep
            agencyName={agencyName}
            setAgencyName={setAgencyName}
            plan={plan}
            setPlan={setPlan}
            submitting={submitting}
            error={error}
            onSubmit={onCreateWorkspace}
          />
        )}

        {step === "teammates" && (
          <TeammatesStep
            invites={invites}
            setInvites={setInvites}
            inviteErrors={inviteErrors}
            setInviteErrors={setInviteErrors}
            submitting={submitting}
            error={error}
            onContinue={onSendInvites}
            onSkip={() => advance("client")}
          />
        )}

        {step === "client" && (
          <ClientStep
            clientName={clientName}
            setClientName={setClientName}
            submitting={submitting}
            error={error}
            onSubmit={onCreateClient}
            onSkip={finish}
          />
        )}
      </Card>

      <p className="mt-5 text-center font-sans text-[12px]" style={{ color: "#8B95A6" }}>
        You can revisit any of these from Settings — nothing here is final.
      </p>
    </>
  );
}

/* ============================================================
   Stepper
   ============================================================ */

const STEPS: { key: Step; label: string }[] = [
  { key: "workspace", label: "Workspace" },
  { key: "teammates", label: "Teammates" },
  { key: "client", label: "First client" },
];

function Stepper({ step, completed }: { step: Step; completed: Set<Step> }) {
  const currentIdx = STEPS.findIndex((s) => s.key === step);
  return (
    <div className="mb-6 flex items-center justify-between">
      {STEPS.map((s, i) => {
        const isDone = completed.has(s.key);
        const isCurrent = s.key === step;
        const reached = i <= currentIdx || isDone;
        return (
          <div key={s.key} className="flex flex-1 items-center" style={{ minWidth: 0 }}>
            <div className="flex min-w-0 flex-1 items-center gap-[10px]">
              <span
                className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full font-sans text-[12px] font-semibold transition-colors"
                style={{
                  background: isDone ? "#2E9E5B" : isCurrent ? "#3A5BA0" : "#FFFFFF",
                  color: reached ? "#FFFFFF" : "#A0A9B8",
                  border: reached ? "none" : "1.5px solid #E6EBF3",
                }}
              >
                {isDone ? (
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 11 11"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2 5.5l2.4 2.4L9 3.5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span
                className="truncate font-sans text-[12.5px] font-medium"
                style={{ color: isCurrent ? "#1A2A4A" : reached ? "#5A6473" : "#A0A9B8" }}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <span
                className="mx-3 h-[2px] flex-1 rounded-full"
                style={{
                  background: i < currentIdx ? "#3A5BA0" : "#E6EBF3",
                  minWidth: 18,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   Step 1 — Workspace
   ============================================================ */

function WorkspaceStep({
  agencyName,
  setAgencyName,
  plan,
  setPlan,
  submitting,
  error,
  onSubmit,
}: {
  agencyName: string;
  setAgencyName: (v: string) => void;
  plan: Plan;
  setPlan: (p: Plan) => void;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
}) {
  const valid = agencyName.trim().length >= 1;

  return (
    <>
      <StepHeader
        kicker="Welcome to Repodcast"
        title="Let's set up your workspace"
        subtitle="Name your agency and pick a plan. You can rename or upgrade anytime."
      />

      <Field label="Agency name" hint="Shown to your team and clients.">
        <Input
          value={agencyName}
          onChange={(e) => setAgencyName(e.target.value)}
          placeholder="Your studio name"
          autoFocus
        />
      </Field>

      <div className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <label className="font-sans text-[12.5px] font-semibold" style={{ color: "#1A2A4A" }}>
            Plan
          </label>
          <span className="font-sans text-[11.5px]" style={{ color: "#8B95A6" }}>
            14-day free trial
          </span>
        </div>
        <div className="grid grid-cols-3 gap-[10px]">
          {PLAN_ORDER.map((p) => {
            const meta = planDisplayFor(p);
            const selected = p === plan;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPlan(p)}
                className="relative flex flex-col items-start gap-[6px] rounded-[12px] p-3 text-left transition-all"
                style={{
                  border: `1.5px solid ${selected ? "#3A5BA0" : "#E6EBF3"}`,
                  background: selected ? "#F7F9FE" : "#FFFFFF",
                  boxShadow: selected
                    ? "0 6px 16px rgba(58,91,160,0.15)"
                    : "0 1px 2px rgba(26,42,74,0.04)",
                }}
              >
                {selected && (
                  <span
                    className="absolute top-2 right-2 flex h-[16px] w-[16px] items-center justify-center rounded-full"
                    style={{ background: "#3A5BA0" }}
                  >
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 10 10"
                      fill="none"
                      stroke="#FFFFFF"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M2 5l2 2 4-4" />
                    </svg>
                  </span>
                )}
                <span
                  className="font-display text-[13px] font-semibold"
                  style={{ color: "#1A2A4A" }}
                >
                  {meta.name}
                </span>
                <span
                  className="font-display text-[18px] leading-none font-bold"
                  style={{ color: selected ? "#3A5BA0" : "#1A2A4A" }}
                >
                  {formatPlanPrice(meta.prices[DEFAULT_CURRENCY], DEFAULT_CURRENCY)}
                  <span className="ml-[2px] text-[11px] font-medium" style={{ color: "#8B95A6" }}>
                    /mo
                  </span>
                </span>
                <span
                  className="font-sans text-[11.5px] leading-[1.35]"
                  style={{ color: "#5A6473" }}
                >
                  {meta.tagline}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 font-sans text-[11.5px]" style={{ color: "#A0A9B8" }}>
          Defaults to {PLAN_DISPLAY[Plan.STUDIO].name}. Change anytime from Settings → Billing.
        </p>
      </div>

      <ErrorBanner error={error} />

      <div className="mt-7">
        <PrimaryCTA
          label={submitting ? "Creating workspace…" : "Create workspace"}
          disabled={!valid || submitting}
          onClick={onSubmit}
        />
      </div>
    </>
  );
}

/* ============================================================
   Step 2 — Teammates
   ============================================================ */

function TeammatesStep({
  invites,
  setInvites,
  inviteErrors,
  setInviteErrors,
  submitting,
  error,
  onContinue,
  onSkip,
}: {
  invites: InviteRow[];
  setInvites: (rows: InviteRow[]) => void;
  inviteErrors: Record<number, string>;
  setInviteErrors: (errs: Record<number, string>) => void;
  submitting: boolean;
  error: string | null;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const clearRowError = (idx: number) => {
    if (inviteErrors[idx] === undefined) return;
    const next = { ...inviteErrors };
    delete next[idx];
    setInviteErrors(next);
  };
  const updateRow = (idx: number, patch: Partial<InviteRow>) => {
    setInvites(invites.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    clearRowError(idx);
  };
  const addRow = () => {
    if (invites.length >= 5) return;
    setInvites([...invites, { email: "", role: "member" }]);
  };
  const removeRow = (idx: number) => {
    clearRowError(idx);
    if (invites.length === 1) {
      setInvites([{ email: "", role: "member" }]);
      return;
    }
    setInvites(invites.filter((_, i) => i !== idx));
  };

  const hasAnyInput = invites.some((r) => r.email.trim().length > 0);
  const primaryLabel = useMemo(() => {
    if (submitting) return "Sending invites…";
    if (!hasAnyInput) return "Skip for now";
    return invites.filter((r) => r.email.trim()).length === 1 ? "Send invite" : "Send invites";
  }, [submitting, hasAnyInput, invites]);

  return (
    <>
      <StepHeader
        kicker="Step 2 of 3"
        title="Invite your teammates"
        subtitle="Add the people who'll edit and review with you. You can always invite more later from Settings → Team."
      />

      <div className="flex flex-col gap-[10px]">
        {invites.map((row, idx) => (
          <div key={idx} className="flex flex-col gap-1">
            <div className="flex items-center gap-[8px]">
              <Input
                value={row.email}
                onChange={(e) => updateRow(idx, { email: e.target.value })}
                placeholder="teammate@studio.com"
                type="email"
                autoComplete="off"
                style={
                  inviteErrors[idx]
                    ? { border: "1px solid #E5A4A0", background: "#FDF6F5" }
                    : undefined
                }
              />
              <RoleToggle value={row.role} onChange={(role) => updateRow(idx, { role })} />
              <button
                type="button"
                onClick={() => removeRow(idx)}
                aria-label="Remove row"
                className="flex h-[38px] w-[34px] flex-shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[#F4F6FA]"
                style={{ color: "#8B95A6" }}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 13 13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                >
                  <path d="M3 3l7 7M10 3l-7 7" />
                </svg>
              </button>
            </div>
            {inviteErrors[idx] && (
              <span className="px-1 text-[11.5px] font-medium text-[#C0392B]">
                {inviteErrors[idx]}
              </span>
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        disabled={invites.length >= 5}
        className="mt-3 inline-flex items-center gap-[6px] font-sans text-[12.5px] font-semibold transition-colors disabled:opacity-40"
        style={{ color: "#3A5BA0" }}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 11 11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M5.5 2v7M2 5.5h7" />
        </svg>
        Add another
      </button>

      <ErrorBanner error={error} />

      <div className="mt-7 flex items-center gap-3">
        <PrimaryCTA label={primaryLabel} disabled={submitting} onClick={onContinue} />
        {hasAnyInput && (
          <SecondaryCTA label="Skip for now" disabled={submitting} onClick={onSkip} />
        )}
      </div>
    </>
  );
}

function RoleToggle({
  value,
  onChange,
}: {
  value: "admin" | "member";
  onChange: (v: "admin" | "member") => void;
}) {
  return (
    <div
      className="flex flex-shrink-0 overflow-hidden rounded-md"
      style={{ border: "1px solid #C9D4E8", background: "#FBFCFE" }}
    >
      {(["member", "admin"] as const).map((opt) => {
        const selected = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className="font-sans text-[11.5px] font-semibold transition-colors"
            style={{
              padding: "9px 10px",
              background: selected ? "#1A2A4A" : "transparent",
              color: selected ? "#FFFFFF" : "#5A6473",
            }}
          >
            {opt === "admin" ? "Admin" : "Editor"}
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================
   Step 3 — First client
   ============================================================ */

function ClientStep({
  clientName,
  setClientName,
  submitting,
  error,
  onSubmit,
  onSkip,
}: {
  clientName: string;
  setClientName: (v: string) => void;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
  onSkip: () => void;
}) {
  const hasInput = clientName.trim().length > 0;
  const primaryLabel = submitting
    ? "Creating client…"
    : hasInput
      ? "Create client & finish"
      : "Skip for now";

  return (
    <>
      <StepHeader
        kicker="Step 3 of 3"
        title="Add your first client"
        subtitle="Clients are the agencies and companies you produce content for. You can add the rest — including artwork, contacts, and shows — from the Clients page."
      />

      <Field
        label="Client name"
        hint="One client per company you work with. You'll add shows under them next."
      >
        <Input
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          placeholder="Northwind Media"
          autoFocus
        />
      </Field>

      <ErrorBanner error={error} />

      <div className="mt-7 flex items-center gap-3">
        <PrimaryCTA label={primaryLabel} disabled={submitting} onClick={onSubmit} />
        {hasInput && <SecondaryCTA label="Skip & finish" disabled={submitting} onClick={onSkip} />}
      </div>
    </>
  );
}

/* ============================================================
   Shared primitives
   ============================================================ */

function StepHeader({
  kicker,
  title,
  subtitle,
}: {
  kicker: string;
  title: string;
  subtitle: string;
}) {
  return (
    <header className="mb-5">
      <div
        className="mb-2 font-sans text-[11.5px] font-semibold tracking-[0.09em] uppercase"
        style={{ color: "#3A5BA0" }}
      >
        {kicker}
      </div>
      <h1
        className="font-display text-[22px] leading-[1.2] font-semibold tracking-[-0.4px] sm:text-[24px]"
        style={{ color: "#1A2A4A" }}
      >
        {title}
      </h1>
      <p className="mt-2 max-w-[520px] text-[13.5px] leading-[1.55]" style={{ color: "#5A6473" }}>
        {subtitle}
      </p>
    </header>
  );
}

function BrandHeader() {
  return (
    <div className="mb-5 flex items-center gap-3">
      <div
        className="font-display flex h-9 w-9 items-center justify-center rounded-[10px] text-[14px] font-bold"
        style={{
          background: "#1A2A4A",
          color: "#FFFFFF",
          boxShadow: "0 4px 12px rgba(26,42,74,0.18)",
        }}
      >
        R
      </div>
      <div
        className="font-display text-[15px] leading-tight font-semibold tracking-[-0.2px]"
        style={{ color: "#1A2A4A" }}
      >
        Repodcast
      </div>
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-[20px] p-6 sm:p-7"
      style={{
        background: "#FFFFFF",
        border: "1px solid #E6EBF3",
        boxShadow: "0 1px 2px rgba(26,42,74,0.06), 0 24px 60px -24px rgba(26,42,74,0.18)",
      }}
    >
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <label className="font-sans text-[12.5px] font-semibold" style={{ color: "#1A2A4A" }}>
          {label}
        </label>
        {hint && (
          <span className="font-sans text-[11.5px]" style={{ color: "#A0A9B8" }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div
      className="mt-5 flex items-start gap-2 rounded-[10px] px-3 py-[10px] text-[12.5px]"
      style={{
        background: "#FBF1DE",
        border: "1px solid #E6D9B8",
        color: "#A06D12",
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-[1px] flex-shrink-0"
      >
        <circle cx="7" cy="7" r="5.5" />
        <path d="M7 4.5v3M7 9.5v.01" />
      </svg>
      <span>{error}</span>
    </div>
  );
}

function PrimaryCTA({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex flex-1 items-center justify-center gap-[10px] rounded-[12px] font-sans font-semibold transition-all"
      style={{
        background: disabled ? "#C3CBD8" : "linear-gradient(135deg, #3A5BA0 0%, #2A4680 100%)",
        color: "#FFFFFF",
        fontSize: "15px",
        padding: "14px 22px",
        border: "1px solid rgba(0,0,0,0.08)",
        boxShadow: disabled
          ? "none"
          : "0 8px 20px rgba(58,91,160,0.32), inset 0 1px 0 rgba(255,255,255,0.15)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <span>{label}</span>
      <svg
        width="15"
        height="15"
        viewBox="0 0 15 15"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-transform group-hover:translate-x-[2px]"
      >
        <path d="M5 3l4.5 4.5L5 12" />
      </svg>
    </button>
  );
}

function SecondaryCTA({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-[12px] font-sans font-semibold transition-colors disabled:opacity-50"
      style={{
        background: "#FFFFFF",
        color: "#5A6473",
        border: "1px solid #E6EBF3",
        fontSize: "14px",
        padding: "13px 18px",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}
