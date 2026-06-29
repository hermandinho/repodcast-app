"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BillingCycle, ClientStatus } from "@prisma/client";
import { Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { updateClientBillingProfileAction } from "@/app/(dashboard)/clients/[key]/billing/actions";

/**
 * Phase 2.13.2 — Billing profile form.
 *
 * Shape mirrors `ClientBillingProfileInput`. Retainer vs. per-episode-rate
 * is a radio (mutually exclusive), and the schema layer enforces it too in
 * case a stale tab submits both. Empty strings are sent through as
 * `undefined` so the repo can normalise to NULL.
 */
export type ClientBillingFormInitial = {
  billingContactName: string;
  billingContactEmail: string;
  retainerCents: number | null;
  ratePerEpisodeCents: number | null;
  billingCycle: BillingCycle;
  currency: string;
  contractStartDate: string; // YYYY-MM-DD
  contractRenewalDate: string;
  status: ClientStatus;
  paymentLinkUrl: string;
  internalNotes: string;
};

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;

const CYCLE_LABELS: Record<BillingCycle, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ANNUAL: "Annual",
  PROJECT: "Project",
};

const STATUS_META: Record<ClientStatus, { label: string; bg: string; color: string }> = {
  ACTIVE: { label: "Active", bg: "#E7F4EC", color: "#1E7A47" },
  PAUSED: { label: "Paused", bg: "#FBF1DE", color: "#A06D12" },
  CHURNED: { label: "Churned", bg: "#FBEDEC", color: "#C0392B" },
};

function dollarsFromCents(cents: number | null): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

function centsFromDollars(dollars: string): number | null {
  const trimmed = dollars.trim();
  if (trimmed === "") return null;
  const num = Number.parseFloat(trimmed);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

export function ClientBillingForm({
  clientId,
  initial,
}: {
  clientId: string;
  initial: ClientBillingFormInitial;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [contactName, setContactName] = useState(initial.billingContactName);
  const [contactEmail, setContactEmail] = useState(initial.billingContactEmail);

  // Compensation: which radio is selected drives which input is read at submit.
  const [comp, setComp] = useState<"retainer" | "rate">(
    initial.ratePerEpisodeCents != null && initial.retainerCents == null ? "rate" : "retainer",
  );
  const [retainerInput, setRetainerInput] = useState(dollarsFromCents(initial.retainerCents));
  const [rateInput, setRateInput] = useState(dollarsFromCents(initial.ratePerEpisodeCents));

  const [billingCycle, setBillingCycle] = useState<BillingCycle>(initial.billingCycle);
  const [currency, setCurrency] = useState(initial.currency);
  const [contractStart, setContractStart] = useState(initial.contractStartDate);
  const [contractRenewal, setContractRenewal] = useState(initial.contractRenewalDate);
  const [status, setStatus] = useState<ClientStatus>(initial.status);
  const [paymentLink, setPaymentLink] = useState(initial.paymentLinkUrl);
  const [notes, setNotes] = useState(initial.internalNotes);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const retainerCents = comp === "retainer" ? centsFromDollars(retainerInput) : null;
    const ratePerEpisodeCents = comp === "rate" ? centsFromDollars(rateInput) : null;

    startTransition(async () => {
      try {
        const result = await updateClientBillingProfileAction({
          clientId,
          profile: {
            billingContactName: contactName || undefined,
            billingContactEmail: contactEmail || undefined,
            retainerCents,
            ratePerEpisodeCents,
            billingCycle,
            currency: currency.toUpperCase(),
            contractStartDate: contractStart || undefined,
            contractRenewalDate: contractRenewal || undefined,
            status,
            paymentLinkUrl: paymentLink || undefined,
            internalNotes: notes || undefined,
          },
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSaved(true);
        router.refresh();
        window.setTimeout(() => setSaved(false), 2000);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed.");
      }
    });
  };

  const statusMeta = STATUS_META[status];

  return (
    <form
      onSubmit={onSubmit}
      className="border-border bg-surface flex flex-col gap-5 rounded-3xl border p-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-display text-ink text-[15px] font-semibold">Billing profile</div>
          <div className="text-muted-2 mt-[3px] text-[12.5px]">
            Metadata only — Repodcast doesn&apos;t collect or process payments between you and your
            client.
          </div>
        </div>
        <span
          className="rounded-pill inline-flex items-center gap-[6px] px-[10px] py-1 font-sans text-[11.5px] font-semibold"
          style={{ background: statusMeta.bg, color: statusMeta.color }}
        >
          <span
            className="block h-[6px] w-[6px] rounded-full"
            style={{ background: statusMeta.color }}
          />
          {statusMeta.label}
        </span>
      </header>

      <Section title="Billing contact">
        <FieldRow>
          <Field label="Name">
            <Input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Avery Lin"
            />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="billing@northwind.com"
            />
          </Field>
        </FieldRow>
      </Section>

      <Section title="Compensation" hint="Choose retainer or per-episode rate.">
        <div className="flex flex-col gap-3">
          <CompRadio
            label="Monthly retainer"
            selected={comp === "retainer"}
            onSelect={() => setComp("retainer")}
          >
            <CentsInput
              value={retainerInput}
              onChange={setRetainerInput}
              currency={currency}
              disabled={comp !== "retainer"}
              placeholder="2500.00"
            />
          </CompRadio>
          <CompRadio
            label="Per-episode rate"
            selected={comp === "rate"}
            onSelect={() => setComp("rate")}
          >
            <CentsInput
              value={rateInput}
              onChange={setRateInput}
              currency={currency}
              disabled={comp !== "rate"}
              placeholder="150.00"
            />
          </CompRadio>
        </div>
      </Section>

      <Section title="Cycle & currency">
        <FieldRow>
          <Field label="Billing cycle">
            <select
              value={billingCycle}
              onChange={(e) => setBillingCycle(e.target.value as BillingCycle)}
              className="w-full rounded-[10px] px-[14px] py-[10px] font-sans text-[13px] text-[#2A3550] outline-none"
              style={{ border: "1px solid #C9D4E8", background: "#FBFCFE" }}
            >
              {(Object.values(BillingCycle) as BillingCycle[]).map((c) => (
                <option key={c} value={c}>
                  {CYCLE_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Currency">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full rounded-[10px] px-[14px] py-[10px] font-sans text-[13px] text-[#2A3550] outline-none"
              style={{ border: "1px solid #C9D4E8", background: "#FBFCFE" }}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
        </FieldRow>
      </Section>

      <Section title="Contract">
        <FieldRow>
          <Field label="Start date">
            <Input
              type="date"
              value={contractStart}
              onChange={(e) => setContractStart(e.target.value)}
            />
          </Field>
          <Field label="Renewal date">
            <Input
              type="date"
              value={contractRenewal}
              min={contractStart || undefined}
              onChange={(e) => setContractRenewal(e.target.value)}
            />
          </Field>
          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ClientStatus)}
              className="w-full rounded-[10px] px-[14px] py-[10px] font-sans text-[13px] text-[#2A3550] outline-none"
              style={{ border: "1px solid #C9D4E8", background: "#FBFCFE" }}
            >
              {(Object.values(ClientStatus) as ClientStatus[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_META[s].label}
                </option>
              ))}
            </select>
          </Field>
        </FieldRow>
      </Section>

      <Section
        title="Client portal payment link"
        hint="External URL — the portal CTA opens this in a new tab. Repodcast never processes the payment."
      >
        <Input
          type="url"
          value={paymentLink}
          onChange={(e) => setPaymentLink(e.target.value)}
          placeholder="https://buy.stripe.com/…"
        />
      </Section>

      <Section title="Internal notes" hint="Visible to OWNER + ADMIN only.">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="Anything the team should remember — renewal terms, pause reason, etc."
        />
      </Section>

      {error && (
        <div className="rounded-md bg-[#FBEDEC] px-3 py-2 font-sans text-[12.5px] font-medium text-[#8A2A1F]">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        {saved && (
          <span className="font-sans text-[12.5px] font-medium text-[#1E7A47]">✓ Saved</span>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save billing profile"}
        </Button>
      </div>
    </form>
  );
}

// ============================================================
// Internal layout primitives
// ============================================================

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-muted font-sans text-[12px] font-semibold tracking-[0.05em] uppercase">
          {title}
        </span>
        {hint && <span className="text-muted-2 text-[11.5px]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-[6px]">
      <span className="text-muted font-sans text-[12px] font-medium">{label}</span>
      {children}
    </label>
  );
}

function CompRadio({
  label,
  selected,
  onSelect,
  children,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-3 py-[10px]"
      style={{
        border: `1.5px solid ${selected ? "var(--color-accent)" : "#E6EBF3"}`,
        background: selected ? "#F7F9FE" : "#FFFFFF",
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full transition-colors"
        style={{
          border: `1.5px solid ${selected ? "var(--color-accent)" : "#CBD4E2"}`,
          background: selected ? "var(--color-accent)" : "#fff",
        }}
        aria-pressed={selected}
        aria-label={label}
      >
        {selected && <span className="block h-2 w-2 rounded-full bg-white" />}
      </button>
      <span className="text-ink w-[140px] font-sans text-[12.5px] font-medium">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function CentsInput({
  value,
  onChange,
  currency,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  currency: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div
      className="flex items-stretch overflow-hidden rounded-[10px]"
      style={{
        border: "1px solid #C9D4E8",
        background: disabled ? "#F7F9FE" : "#FBFCFE",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span className="text-muted-2 flex items-center px-3 font-sans text-[12.5px] font-medium">
        {currency}
      </span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="w-full bg-transparent px-3 py-[10px] font-sans text-[13px] text-[#2A3550] outline-none disabled:cursor-not-allowed"
        style={{ borderLeft: "1px solid #C9D4E8" }}
      />
    </div>
  );
}
