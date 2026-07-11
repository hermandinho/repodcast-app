import Link from "next/link";
import { notFound } from "next/navigation";
import { AgencyActionsPanel } from "@/components/root/agency-actions-panel";
import { AgencyMembersPanel } from "@/components/root/agency-members-panel";
import { NotFoundError } from "@/server/auth/errors";
import { requireSystemAdminContext } from "@/server/auth/system";
import { prisma } from "@/server/db/client";
import {
  getAgencyForRoot,
  listAgencyAuditEntries,
  listAgencyMembers,
} from "@/server/db/system/agencies";

export const dynamic = "force-dynamic";

function formatCents(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return "—";
  return date.toISOString().slice(0, 10);
}

function formatRelative(date: Date | null | undefined): string {
  if (!date) return "—";
  const diffMs = Date.now() - date.getTime();
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default async function RootAgencyDrilldownPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    impersonate_error?: string;
    impersonation_ended?: string;
    action_error?: string;
    action_ok?: string;
  }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireSystemAdminContext();

  let agency;
  try {
    agency = await getAgencyForRoot(ctx, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const [auditEntries, members, latestInvoice] = await Promise.all([
    listAgencyAuditEntries(ctx, id, 10),
    listAgencyMembers(ctx, id),
    prisma.invoice.findFirst({
      where: { agencyId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        stripeInvoiceId: true,
        amountCents: true,
        currency: true,
        status: true,
        createdAt: true,
      },
    }),
  ]);

  const stripeUrl = agency.stripeCustomerId
    ? `https://dashboard.stripe.com/customers/${agency.stripeCustomerId}`
    : null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <nav className="text-sm text-zinc-500">
        <Link href="/root/agencies" className="hover:text-zinc-300">
          ← All agencies
        </Link>
      </nav>

      <header className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
              {agency.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-400">
              <span className="font-mono text-[11px] tracking-wider text-zinc-500 uppercase">
                {agency.plan}
              </span>
              <span className="text-zinc-700">·</span>
              <span>Created {formatDate(agency.createdAt)}</span>
              <span className="text-zinc-700">·</span>
              <span className="font-mono text-[11.5px] text-zinc-500">{agency.id}</span>
            </div>
            {agency.owner ? (
              <div className="text-sm text-zinc-400">
                Owner:{" "}
                <span className="text-zinc-200">{agency.owner.name ?? agency.owner.email}</span>
                {agency.owner.name ? (
                  <span className="text-zinc-500"> · {agency.owner.email}</span>
                ) : null}
              </div>
            ) : (
              <div className="text-sm text-amber-300">No OWNER member on this agency.</div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2 text-right">
            {stripeUrl ? (
              <a
                href={stripeUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-sm text-sky-300 hover:underline"
              >
                Open in Stripe ↗
              </a>
            ) : (
              <span className="text-sm text-zinc-500">No Stripe customer linked</span>
            )}
          </div>
        </div>
      </header>

      {sp.impersonate_error ? (
        <div className="rounded-lg border border-red-700/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          Couldn&apos;t open impersonation: <code>{sp.impersonate_error}</code>.
        </div>
      ) : null}
      {sp.impersonation_ended ? (
        <div className="rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
          Impersonation ended.
        </div>
      ) : null}
      {sp.action_error ? (
        <div className="rounded-lg border border-red-700/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {ACTION_ERROR_COPY[sp.action_error] ?? ACTION_ERROR_COPY.unknown}
        </div>
      ) : null}
      {sp.action_ok ? (
        <div className="rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
          {ACTION_OK_COPY[sp.action_ok] ?? "Change applied."}
        </div>
      ) : null}
      {agency.suspendedAt ? (
        <div className="rounded-lg border border-red-700/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          This agency is <strong>suspended</strong> as of{" "}
          {agency.suspendedAt.toISOString().slice(0, 10)}. Tenant dashboard access is blocked until
          an operator unsuspends.
        </div>
      ) : null}

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-semibold text-white">Month to date</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatTile label="Episodes" value={agency.monthToDate.episodes.toLocaleString()} />
          <StatTile label="Outputs" value={agency.monthToDate.outputs.toLocaleString()} />
          <StatTile
            label="Cost (AI spend)"
            value={formatCents(agency.monthToDate.costCents)}
            hint="UsageLog sum, current month"
          />
          <StatTile
            label="Revenue (paid invoices)"
            value={formatCents(agency.monthToDate.revenueCents, agency.preferredCurrency)}
            hint="Sum of PAID invoices in window"
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-semibold text-white">Lifetime totals</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
          <StatTile label="Members" value={agency.totals.members.toLocaleString()} compact />
          <StatTile label="Clients" value={agency.totals.clients.toLocaleString()} compact />
          <StatTile label="Shows" value={agency.totals.shows.toLocaleString()} compact />
          <StatTile label="Episodes" value={agency.totals.episodes.toLocaleString()} compact />
          <StatTile
            label="Current outputs"
            value={agency.totals.outputs.toLocaleString()}
            compact
          />
          <StatTile
            label="Paid invoices"
            value={agency.totals.invoicesPaid.toLocaleString()}
            compact
          />
        </div>
      </section>

      <AgencyMembersPanel agencyId={agency.id} members={members} viewerRole={ctx.admin.role} />

      <AgencyActionsPanel
        agencyId={agency.id}
        agencyName={agency.name}
        agencyPlan={agency.plan}
        planOverride={agency.planOverride}
        compAccessExpiresAt={agency.compAccessExpiresAt}
        suspendedAt={agency.suspendedAt}
        stripeSubscriptionId={agency.stripeSubscriptionId}
        latestInvoice={latestInvoice}
        trialStatus={agency.trialStatus}
        trialEndsAt={agency.trialEndsAt}
        activeDiscountLabel={agency.activeDiscountLabel}
        activeDiscountEndsAt={agency.activeDiscountEndsAt}
        viewerRole={ctx.admin.role}
      />

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg font-semibold text-white">
            Recent platform-admin activity
          </h2>
          <span className="text-sm text-zinc-500">
            Last activity {formatRelative(agency.lastActivityAt)}
          </span>
        </div>
        {auditEntries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
            No ROOT-side actions have targeted this agency yet.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {auditEntries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3"
              >
                <div className="flex flex-col">
                  <span className="font-mono text-[11.5px] tracking-wider text-zinc-300 uppercase">
                    {entry.action}
                  </span>
                  <span className="text-[12.5px] text-zinc-500">
                    {entry.actor.name ?? entry.actor.email}
                    {entry.note ? ` · ${entry.note}` : null}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-zinc-500">
                  {entry.createdAt.toISOString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const ACTION_ERROR_COPY: Record<string, string> = {
  invalid: "Invalid input — check the required fields.",
  forbidden: "This action requires a ROOT or OPERATOR system role.",
  not_found: "The record you targeted no longer exists.",
  invalid_plan: "Choose a valid plan tier.",
  confirm_mismatch: "The agency name you typed doesn't match. Action canceled.",
  unknown: "Something went wrong. Check the server logs.",
};

const ACTION_OK_COPY: Record<string, string> = {
  suspended: "Agency suspended. Tenant dashboard access is now blocked.",
  unsuspended: "Agency unsuspended. Tenant dashboard access restored.",
  override_granted: "Plan override granted.",
  override_revoked: "Plan override revoked.",
  comp_access_granted: "Comp access granted. The agency now clears the paid-only gate.",
  comp_access_extended: "Comp access extended.",
  comp_access_revoked: "Comp access revoked. Standard billing gate applies again.",
  subscription_canceled: "Stripe subscription canceled; local plan downgraded to STUDIO.",
  trial_extended: "Trial extended. Stripe and local trialEndsAt updated.",
  discount_applied:
    "Discount attached to the Stripe subscription. Buyer sees it on their billing page.",
  discount_removed: "Discount removed. The sticker price applies again on the next invoice.",
};

function StatTile({
  label,
  value,
  hint,
  compact = false,
}: {
  label: string;
  value: string;
  hint?: string;
  compact?: boolean;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="font-mono text-[10.5px] tracking-wider text-zinc-500 uppercase">{label}</div>
      <div
        className={`font-display mt-2 font-semibold tracking-tight text-white tabular-nums ${
          compact ? "text-2xl" : "text-3xl"
        }`}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-[11.5px] text-zinc-500">{hint}</div> : null}
    </div>
  );
}
