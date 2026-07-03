import type { InvoiceStatus, Plan, SystemAdminRole, TrialStatus } from "@prisma/client";
import {
  extendAgencyTrialAction,
  forceCancelAgencySubscriptionAction,
  grantAgencyPlanOverrideAction,
  hardDeleteAgencyAction,
  recordInvoiceRefundIntentAction,
  revokeAgencyPlanOverrideAction,
  suspendAgencyAction,
  unsuspendAgencyAction,
} from "@/app/(root)/root/agencies/[id]/root-actions";

/**
 * Phase 3.6.5 — ROOT-side actions rendered on the agency drilldown's
 * Overview tab. Server-rendered; each form POSTs to a `"use server"`
 * action. Destructive actions gate on typing the agency name (server-side
 * comparison against a hidden expected-name field).
 *
 * `viewerRole` gates the whole panel: SUPPORT / ANALYST see a notice, not
 * the buttons. The server actions repeat the gate at the repo layer, so
 * this UI-side hide is UX polish, not a security boundary.
 */
export function AgencyActionsPanel({
  agencyId,
  agencyName,
  agencyPlan,
  planOverride,
  suspendedAt,
  stripeSubscriptionId,
  latestInvoice,
  trialStatus,
  trialEndsAt,
  viewerRole,
}: {
  agencyId: string;
  agencyName: string;
  agencyPlan: Plan;
  planOverride: Plan | null;
  suspendedAt: Date | null;
  stripeSubscriptionId: string | null;
  latestInvoice: {
    id: string;
    stripeInvoiceId: string;
    amountCents: number;
    currency: string;
    status: InvoiceStatus;
    createdAt: Date;
  } | null;
  trialStatus: TrialStatus;
  trialEndsAt: Date | null;
  viewerRole: SystemAdminRole;
}) {
  const canWrite = viewerRole === "ROOT" || viewerRole === "OPERATOR";

  if (!canWrite) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-white">ROOT actions</h2>
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 p-4 text-[12.5px] text-zinc-500">
          Your role can view but not act on agencies. Ask a ROOT or OPERATOR to make changes.
        </div>
      </section>
    );
  }

  const isSuspended = suspendedAt !== null;
  const hasOverride = planOverride !== null;
  const hasSub = Boolean(stripeSubscriptionId);
  const canHardDelete = viewerRole === "ROOT";

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold text-white">ROOT actions</h2>
        {isSuspended ? (
          <span className="rounded bg-red-500/20 px-2 py-0.5 font-mono text-[10.5px] tracking-wider text-red-200 uppercase">
            Suspended
          </span>
        ) : hasOverride ? (
          <span className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-[10.5px] tracking-wider text-amber-200 uppercase">
            Override: {planOverride}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SuspendCard agencyId={agencyId} isSuspended={isSuspended} suspendedAt={suspendedAt} />
        <PlanOverrideCard agencyId={agencyId} agencyPlan={agencyPlan} planOverride={planOverride} />
        <ForceCancelCard agencyId={agencyId} agencyName={agencyName} hasSub={hasSub} />
        <RefundCard agencyId={agencyId} latestInvoice={latestInvoice} />
        {trialStatus === "ACTIVE" ? (
          <ExtendTrialCard agencyId={agencyId} trialEndsAt={trialEndsAt} />
        ) : null}
      </div>

      {canHardDelete ? (
        <HardDeleteCard agencyId={agencyId} agencyName={agencyName} hasSub={hasSub} />
      ) : null}
    </section>
  );
}

// ============================================================
// Suspend / unsuspend
// ============================================================

function SuspendCard({
  agencyId,
  isSuspended,
  suspendedAt,
}: {
  agencyId: string;
  isSuspended: boolean;
  suspendedAt: Date | null;
}) {
  return (
    <ActionCard
      label="Suspension"
      description={
        isSuspended
          ? `Suspended ${suspendedAt?.toISOString().slice(0, 10)}. Unsuspending restores dashboard access.`
          : "Suspending bounces the tenant dashboard to an 'account suspended' screen. Data preserved."
      }
    >
      <form
        action={isSuspended ? unsuspendAgencyAction : suspendAgencyAction}
        className="flex flex-col gap-2"
      >
        <input type="hidden" name="id" value={agencyId} />
        <input
          type="text"
          name="note"
          required
          minLength={3}
          maxLength={500}
          placeholder={
            isSuspended ? "Reason to unsuspend (required)" : "Reason to suspend (required)"
          }
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-[12.5px] text-zinc-100 placeholder:text-zinc-500"
        />
        <button
          type="submit"
          className={
            isSuspended
              ? "rounded border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-[12.5px] font-medium text-emerald-100 hover:bg-emerald-500/20"
              : "rounded border border-red-500/60 bg-red-500/10 px-3 py-2 text-[12.5px] font-medium text-red-100 hover:bg-red-500/20"
          }
        >
          {isSuspended ? "Unsuspend agency" : "Suspend agency"}
        </button>
      </form>
    </ActionCard>
  );
}

// ============================================================
// Plan override
// ============================================================

const PLAN_OPTIONS: readonly Plan[] = ["STUDIO", "AGENCY", "NETWORK"];

function PlanOverrideCard({
  agencyId,
  agencyPlan,
  planOverride,
}: {
  agencyId: string;
  agencyPlan: Plan;
  planOverride: Plan | null;
}) {
  return (
    <ActionCard
      label="Plan override"
      description={
        planOverride
          ? `Effective plan: ${planOverride} (paid tier: ${agencyPlan}). Absolute — replaces the plan default outright.`
          : `Effective plan: ${agencyPlan}. Grant an override to comp capacity above (or below) the paid tier.`
      }
    >
      <form action={grantAgencyPlanOverrideAction} className="flex flex-col gap-2">
        <input type="hidden" name="id" value={agencyId} />
        <select
          name="plan"
          required
          defaultValue={planOverride ?? ""}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-[12.5px] text-zinc-100"
        >
          <option value="" disabled>
            Choose an override plan
          </option>
          {PLAN_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          type="text"
          name="note"
          required
          minLength={3}
          maxLength={500}
          placeholder="Reason (comp partner, support case 123)"
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-[12.5px] text-zinc-100 placeholder:text-zinc-500"
        />
        <button
          type="submit"
          className="rounded border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-[12.5px] font-medium text-amber-100 hover:bg-amber-500/20"
        >
          {planOverride ? "Update override" : "Grant override"}
        </button>
      </form>
      {planOverride ? (
        <form action={revokeAgencyPlanOverrideAction} className="mt-2 flex items-center gap-2">
          <input type="hidden" name="id" value={agencyId} />
          <input
            type="text"
            name="note"
            required
            minLength={3}
            maxLength={500}
            placeholder="Reason to revoke"
            className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-[12.5px] text-zinc-100 placeholder:text-zinc-500"
          />
          <button
            type="submit"
            className="rounded border border-zinc-700 px-3 py-2 text-[12.5px] text-zinc-300 hover:bg-zinc-800"
          >
            Revoke override
          </button>
        </form>
      ) : null}
    </ActionCard>
  );
}

// ============================================================
// Force-cancel subscription
// ============================================================

function ForceCancelCard({
  agencyId,
  agencyName,
  hasSub,
}: {
  agencyId: string;
  agencyName: string;
  hasSub: boolean;
}) {
  if (!hasSub) {
    return (
      <ActionCard
        label="Force-cancel subscription"
        description="No active Stripe subscription. Nothing to cancel."
      >
        <div className="rounded border border-dashed border-zinc-800 bg-zinc-900/20 p-3 text-[12px] text-zinc-500">
          The agency isn&rsquo;t on a paid plan.
        </div>
      </ActionCard>
    );
  }

  return (
    <ActionCard
      label="Force-cancel subscription"
      description="Cancels the Stripe subscription with invoice_now + prorate, then downgrades the tenant to STUDIO. The webhook idempotently confirms."
    >
      <form action={forceCancelAgencySubscriptionAction} className="flex flex-col gap-2">
        <input type="hidden" name="id" value={agencyId} />
        <input type="hidden" name="expectedName" value={agencyName} />
        <input
          type="text"
          name="confirmName"
          required
          placeholder={`Type "${agencyName}" to confirm`}
          className="rounded-md border border-red-900/60 bg-zinc-950 px-3 py-2 text-[12.5px] text-zinc-100 placeholder:text-zinc-500"
        />
        <input
          type="text"
          name="note"
          required
          minLength={3}
          maxLength={500}
          placeholder="Reason (audit log)"
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-[12.5px] text-zinc-100 placeholder:text-zinc-500"
        />
        <button
          type="submit"
          className="rounded border border-red-500/60 bg-red-500/10 px-3 py-2 text-[12.5px] font-medium text-red-100 hover:bg-red-500/20"
        >
          Cancel subscription
        </button>
      </form>
    </ActionCard>
  );
}

// ============================================================
// Refund intent
// ============================================================

function formatCents(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
  }
}

function RefundCard({
  agencyId,
  latestInvoice,
}: {
  agencyId: string;
  latestInvoice: {
    id: string;
    stripeInvoiceId: string;
    amountCents: number;
    currency: string;
    status: InvoiceStatus;
    createdAt: Date;
  } | null;
}) {
  if (!latestInvoice) {
    return (
      <ActionCard label="Refund last invoice" description="No invoices on file. Nothing to refund.">
        <div className="rounded border border-dashed border-zinc-800 bg-zinc-900/20 p-3 text-[12px] text-zinc-500">
          The agency has no invoice history yet.
        </div>
      </ActionCard>
    );
  }

  return (
    <ActionCard
      label="Refund last invoice"
      description="Records the intent in the audit log and hops you to the Stripe dashboard. The actual refund happens in Stripe so the webhook stays the single source of truth."
    >
      <div className="mb-2 rounded border border-zinc-800 bg-zinc-950 p-2 text-[11.5px] text-zinc-300">
        <span className="font-mono">{latestInvoice.stripeInvoiceId}</span>{" "}
        <span className="text-zinc-500">·</span>{" "}
        {formatCents(latestInvoice.amountCents, latestInvoice.currency)}{" "}
        <span className="text-zinc-500">·</span>{" "}
        <span className="font-mono uppercase">{latestInvoice.status}</span>{" "}
        <span className="text-zinc-500">·</span>{" "}
        {latestInvoice.createdAt.toISOString().slice(0, 10)}
      </div>
      <form action={recordInvoiceRefundIntentAction} className="flex flex-col gap-2">
        <input type="hidden" name="agencyId" value={agencyId} />
        <input type="hidden" name="invoiceId" value={latestInvoice.id} />
        <input
          type="text"
          name="note"
          required
          minLength={3}
          maxLength={500}
          placeholder="Why (audit log)"
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-[12.5px] text-zinc-100 placeholder:text-zinc-500"
        />
        <button
          type="submit"
          className="rounded border border-sky-500/60 bg-sky-500/10 px-3 py-2 text-[12.5px] font-medium text-sky-100 hover:bg-sky-500/20"
        >
          Log intent &amp; open Stripe →
        </button>
      </form>
    </ActionCard>
  );
}

// ============================================================
// Building blocks
// ============================================================

function ActionCard({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <header>
        <h3 className="font-display text-[15px] font-semibold text-white">{label}</h3>
        <p className="mt-1 text-[12px] text-zinc-500">{description}</p>
      </header>
      {children}
    </article>
  );
}

// ============================================================
// Extend trial (Phase 3.9)
// ============================================================

function ExtendTrialCard({
  agencyId,
  trialEndsAt,
}: {
  agencyId: string;
  trialEndsAt: Date | null;
}) {
  const endsLabel = trialEndsAt ? trialEndsAt.toISOString().slice(0, 10) : "unknown";
  return (
    <ActionCard
      label="Extend trial"
      description={`Currently ends ${endsLabel}. Bumping the window pushes Stripe's trial_end and mirrors locally in the same audit TX.`}
    >
      <form action={extendAgencyTrialAction} className="flex flex-col gap-2">
        <input type="hidden" name="id" value={agencyId} />
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-wider text-zinc-500 uppercase">
            Additional days (1–30)
          </span>
          <input
            type="number"
            name="additionalDays"
            defaultValue={7}
            min={1}
            max={30}
            required
            className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-[12.5px] text-zinc-100"
          />
        </label>
        <input
          type="text"
          name="note"
          required
          minLength={3}
          maxLength={500}
          placeholder="Reason (required — appears on audit log)"
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-[12.5px] text-zinc-100 placeholder:text-zinc-500"
        />
        <button
          type="submit"
          className="rounded border border-emerald-500/60 bg-emerald-500/10 px-3 py-2 text-[12.5px] font-medium text-emerald-100 hover:bg-emerald-500/20"
        >
          Extend trial
        </button>
      </form>
    </ActionCard>
  );
}

// ============================================================
// Hard-delete (danger zone)
// ============================================================
//
// Rendered as a full-width panel BELOW the action grid so it can't be
// mis-clicked in the middle of a scan. ROOT-only. Two safeguards:
//   1. Type-agency-name-to-confirm (server-verified against a hidden
//      `expectedName` field to defeat DOM edits).
//   2. Blocks when an active Stripe subscription is still linked — the
//      operator must force-cancel first so Stripe stops billing a ghost.

function HardDeleteCard({
  agencyId,
  agencyName,
  hasSub,
}: {
  agencyId: string;
  agencyName: string;
  hasSub: boolean;
}) {
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-red-900/60 bg-red-950/20 p-5">
      <header>
        <div className="flex items-center gap-2">
          <h3 className="font-display text-[15px] font-semibold text-red-100">
            Hard-delete agency
          </h3>
          <span className="rounded bg-red-500/20 px-2 py-0.5 font-mono text-[10px] tracking-wider text-red-200 uppercase">
            ROOT only · irreversible
          </span>
        </div>
        <p className="mt-1 text-[12px] text-red-200/80">
          Cascade-deletes every tenant row (members, clients, shows, episodes, outputs, invoices,
          usage). R2 objects under{" "}
          <code className="rounded bg-red-950/60 px-1 py-0.5 font-mono text-[11px] text-red-100">
            audio/&lt;id&gt;/
          </code>{" "}
          and{" "}
          <code className="rounded bg-red-950/60 px-1 py-0.5 font-mono text-[11px] text-red-100">
            artwork/&lt;id&gt;/
          </code>{" "}
          are quarantined to{" "}
          <code className="rounded bg-red-950/60 px-1 py-0.5 font-mono text-[11px] text-red-100">
            _quarantine/&lt;id&gt;/&lt;ts&gt;/
          </code>{" "}
          for 30 days before final purge. Audit log survives.
        </p>
      </header>

      {hasSub ? (
        <div className="rounded border border-red-900/60 bg-red-950/40 p-3 text-[12px] text-red-200">
          Blocked — force-cancel the Stripe subscription first (Stripe would otherwise keep billing
          a ghost).
        </div>
      ) : (
        <form action={hardDeleteAgencyAction} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={agencyId} />
          <input type="hidden" name="expectedName" value={agencyName} />
          <input
            type="text"
            name="confirmName"
            required
            autoComplete="off"
            placeholder={`Type "${agencyName}" to confirm`}
            className="rounded-md border border-red-900/60 bg-zinc-950 px-3 py-2 text-[12.5px] text-zinc-100 placeholder:text-red-300/40"
          />
          <textarea
            name="note"
            required
            minLength={10}
            maxLength={2000}
            rows={3}
            placeholder="Reason — mandatory long note for the audit log (min 10 chars)"
            className="rounded-md border border-red-900/60 bg-zinc-950 px-3 py-2 text-[12.5px] text-zinc-100 placeholder:text-red-300/40"
          />
          <button
            type="submit"
            className="rounded border border-red-500/60 bg-red-500/20 px-3 py-2 text-[12.5px] font-semibold tracking-wider text-red-100 uppercase hover:bg-red-500/30"
          >
            Delete agency permanently
          </button>
        </form>
      )}
    </article>
  );
}
