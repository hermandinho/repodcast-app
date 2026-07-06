import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MemberRole } from "@prisma/client";
import { shareStatementAction } from "../actions";
import {
  StatementItemsEditor,
  type StatementItemRow,
} from "@/components/statements/statement-items-editor";
import { computeStatementAggregates, getClientStatement } from "@/server/db/client-statements";
import { listStatementItems } from "@/server/db/client-statement-items";
import { getClientForUI, isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";

/**
 * Phase 2.13.4 — Statement detail. Phase 3.8 wired up PDF export + the
 * "Send to client portal" toggle.
 *
 * The share button is enabled once the client has at least one active
 * (unrevoked, unexpired) portal link — sharing without a live token would
 * publish into a portal no one can reach. When no portal link exists the
 * button surfaces as a hint pointing at the billing tab where the operator
 * mints one.
 */

function formatShortDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function formatCurrency(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

async function hasActivePortalLink(clientId: string): Promise<boolean> {
  const now = new Date();
  const count = await prisma.clientPortalLink.count({
    where: {
      clientId,
      revokedAt: null,
      expiresAt: { gt: now },
    },
  });
  return count > 0;
}

export default async function ClientStatementDetailPage({
  params,
}: {
  params: Promise<{ key: string; id: string }>;
}) {
  const { key, id } = await params;
  const tenant = await resolveTenantContext();
  if (tenant.role !== MemberRole.OWNER && tenant.role !== MemberRole.ADMIN) {
    redirect(`/clients/${key}`);
  }

  const client = await getClientForUI(tenant, key);
  if (!client) notFound();

  if (!isLiveDb()) {
    return (
      <SampleDataNotice
        clientName={client.name}
        statementsHref={`/clients/${client.key}/statements`}
      />
    );
  }

  let statement;
  try {
    statement = await getClientStatement(tenant, id);
  } catch {
    notFound();
  }

  if (statement.client.id !== client.key) notFound();

  // Delivery counts are recomputed live from current output state so pre-
  // fix rows (which persisted `approvedCount = 0` because the old query
  // filtered by `status === APPROVED` only) show the correct numbers
  // without a manual regenerate. Persisted columns on the row stay for
  // the list page's bulk read.
  const [items, liveAggregates] = await Promise.all([
    listStatementItems(tenant, statement.id),
    computeStatementAggregates(
      tenant,
      statement.client.id,
      statement.periodStart,
      statement.periodEnd,
    ),
  ]);
  const itemRows: StatementItemRow[] = items.map((it) => ({
    id: it.id,
    description: it.description,
    quantity: Number(it.quantity),
    unitAmountCents: it.unitAmountCents,
    amountCents: it.amountCents,
  }));
  const totalCents = itemRows.reduce((sum, r) => sum + r.amountCents, 0);

  const generatedBy = statement.generatedByMember
    ? statement.generatedByMember.name?.trim() || statement.generatedByMember.email
    : "system";

  const isShared = statement.sharedWithPortalAt !== null;
  const sharedBy = statement.sharedByMember
    ? statement.sharedByMember.name?.trim() || statement.sharedByMember.email
    : null;
  const hasPortalLink = await hasActivePortalLink(client.key);

  const pdfHref = `/api/clients/${client.key}/statements/${statement.id}/pdf`;
  const csvHref = `/api/clients/${client.key}/statements/${statement.id}`;

  return (
    <div className="flex flex-col gap-5">
      <section className="border-border bg-surface flex flex-wrap items-start justify-between gap-4 rounded-3xl border p-5">
        <div>
          <Link
            href={`/clients/${client.key}/statements`}
            className="text-muted hover:text-ink mb-3 inline-flex items-center gap-[6px] font-sans text-[12.5px] font-medium transition-colors"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 13 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8 3L4 6.5l4 3.5" />
            </svg>
            All statements
          </Link>
          <div className="font-display text-ink text-[20px] font-semibold tracking-[-0.3px]">
            Statement — {formatShortDate(statement.periodStart)} →{" "}
            {formatShortDate(statement.periodEnd)}
          </div>
          <div className="text-muted-2 mt-1 text-[12.5px]">
            Generated by {generatedBy} on {formatShortDate(statement.generatedAt)}
          </div>
          {isShared && statement.sharedWithPortalAt && (
            <div className="mt-2 inline-flex items-center gap-[6px] rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11.5px] font-medium text-emerald-800">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Shared with client portal
              {sharedBy && ` · by ${sharedBy}`} · {formatShortDate(statement.sharedWithPortalAt)}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={csvHref}
            className="border-border text-accent hover:border-accent-border rounded-md border bg-white px-3 py-2 font-sans text-[12.5px] font-semibold transition-colors"
            download
          >
            Export CSV
          </a>
          <a
            href={pdfHref}
            className="border-border text-accent hover:border-accent-border rounded-md border bg-white px-3 py-2 font-sans text-[12.5px] font-semibold transition-colors"
            download
          >
            Export PDF
          </a>
          <SharePortalButton
            clientKey={client.key}
            statementId={statement.id}
            isShared={isShared}
            hasPortalLink={hasPortalLink}
          />
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatBlock label="Episodes" value={liveAggregates.episodeCount} />
        <StatBlock label="Outputs" value={liveAggregates.outputCount} />
        <StatBlock
          label="Approved"
          value={`${liveAggregates.approvedCount} (${liveAggregates.approvalRatePct}%)`}
        />
        <StatBlock label="Client owes" value={formatCurrency(totalCents, statement.currency)} />
      </section>

      <StatementItemsEditor
        clientKey={client.key}
        statementId={statement.id}
        currency={statement.currency}
        initialItems={itemRows}
      />

      <section className="border-border bg-surface rounded-3xl border p-5">
        <div className="font-display text-ink text-[14px] font-semibold">About this statement</div>
        <div className="text-muted mt-2 text-[12.5px] leading-[1.55]">
          Delivery counts above reflect the current state of outputs in this window — regenerated or
          newly-approved items are picked up on every load. Line items are editable and represent
          what you&apos;re billing the client for the period. Use the CSV export to attach the
          summary to your own invoice, or the PDF for a client-ready deliverable. Sharing to the
          client portal makes this statement visible under the client&apos;s existing portal link —
          you can unshare at any time.
        </div>
      </section>
    </div>
  );
}

/**
 * Portal share button. Renders a form action wrapper that flips
 * `sharedWithPortalAt` on/off. If the client has no active portal link, the
 * button becomes a disabled hint pointing at billing where the link is
 * minted — sharing without a live token would publish into a portal no one
 * can reach.
 */
function SharePortalButton({
  clientKey,
  statementId,
  isShared,
  hasPortalLink,
}: {
  clientKey: string;
  statementId: string;
  isShared: boolean;
  hasPortalLink: boolean;
}) {
  if (!hasPortalLink) {
    return (
      <Link
        href={`/clients/${clientKey}/billing`}
        className="border-border bg-canvas text-muted hover:border-accent-border hover:text-ink rounded-md border px-3 py-2 font-sans text-[12.5px] font-medium"
        title="Mint a portal link on the billing tab first."
      >
        Send to client portal
      </Link>
    );
  }

  return (
    <form
      action={async () => {
        "use server";
        await shareStatementAction({
          clientKey,
          statementId,
          share: !isShared,
        });
      }}
    >
      <button
        type="submit"
        className={
          isShared
            ? "border-border text-muted rounded-md border bg-white px-3 py-2 font-sans text-[12.5px] font-semibold transition-colors hover:border-red-200 hover:text-red-700"
            : "border-accent-border bg-accent rounded-md border px-3 py-2 font-sans text-[12.5px] font-semibold text-white transition-[filter] hover:brightness-95"
        }
      >
        {isShared ? "Unshare from portal" : "Send to client portal"}
      </button>
    </form>
  );
}

function StatBlock({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-border bg-surface rounded-2xl border p-4">
      <div className="text-muted-2 font-sans text-[11.5px] font-medium tracking-[0.05em] uppercase">
        {label}
      </div>
      <div className="font-display text-ink mt-2 text-[24px] font-bold tracking-[-0.4px]">
        {value}
      </div>
    </div>
  );
}

function SampleDataNotice({
  clientName,
  statementsHref,
}: {
  clientName: string;
  statementsHref: string;
}) {
  return (
    <section className="border-border bg-canvas rounded-3xl border border-dashed p-6 text-center">
      <div className="font-display text-ink text-[16px] font-semibold">Sample-data mode</div>
      <p className="text-muted mx-auto mt-2 max-w-[480px] text-[13px]">
        Statements are stored in the database — connect a Postgres URL and regenerate to see the
        persisted version for {clientName}.
      </p>
      <Link
        href={statementsHref}
        className="border-border text-muted hover:border-accent-border hover:text-accent mt-4 inline-flex rounded-md border bg-white px-3 py-2 font-sans text-[12.5px] font-medium"
      >
        Back to statements
      </Link>
    </section>
  );
}
