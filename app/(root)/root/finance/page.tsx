import Link from "next/link";
import { requireSystemAdminContext } from "@/server/auth/system";
import {
  getFinanceSummary,
  listInvoicesForRoot,
  type FinanceSummary,
  type InvoiceRowForRoot,
} from "@/server/db/system/finance";

export const dynamic = "force-dynamic";

const INVOICE_STATUSES = ["DRAFT", "OPEN", "PAID", "VOID", "UNCOLLECTIBLE"] as const;
type InvoiceStatusParam = (typeof INVOICE_STATUSES)[number];

function formatCents(cents: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    // Unknown currency code — fall back to a manual format so the page stays
    // alive on a stray ISO code.
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

function formatMonthLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function isInvoiceStatusParam(value: string | undefined): value is InvoiceStatusParam {
  return value !== undefined && (INVOICE_STATUSES as readonly string[]).includes(value);
}

export default async function RootFinancePage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    status?: string;
    createdFrom?: string;
    createdTo?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const ctx = await requireSystemAdminContext();

  const pageNum = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const PAGE_SIZE = 25;
  const filterArgs = {
    search: sp.search?.trim() || undefined,
    status: isInvoiceStatusParam(sp.status) ? sp.status : undefined,
    createdFrom: sp.createdFrom || undefined,
    createdTo: sp.createdTo || undefined,
  };

  const [summary, invoicePage] = await Promise.all([
    getFinanceSummary(ctx),
    listInvoicesForRoot(ctx, {
      ...filterArgs,
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
    }),
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white">Finance</h1>
          <p className="mt-1 text-sm text-zinc-500">
            MRR breakdown, signup cohorts, invoice ledger. Numbers reconcile against Stripe within
            ±1% — anything wider is a bug.
          </p>
        </div>
        <CsvLink filters={filterArgs} />
      </header>

      <SummaryTiles summary={summary} />

      <PlanBreakdown summary={summary} />

      <CurrencyBreakdown summary={summary} />

      <CohortTable summary={summary} />

      <InvoiceFilters initial={{ ...filterArgs, page: pageNum }} />

      <InvoiceTable
        rows={invoicePage.rows}
        total={invoicePage.total}
        page={pageNum}
        pageSize={PAGE_SIZE}
        filters={filterArgs}
      />
    </div>
  );
}

// ============================================================
// Sub-sections
// ============================================================

function SummaryTiles({ summary }: { summary: FinanceSummary }) {
  return (
    <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <StatTile label="MRR" value={formatCents(summary.mrr.totalCents)} hint="USD-normalized" />
      <StatTile
        label="ARR"
        value={formatCents(summary.mrr.arrCents)}
        hint={`${summary.mrr.payingAgencies} paying agencies`}
      />
      <StatTile
        label="Paid lifetime"
        value={formatCents(summary.invoices.paidLifetimeCents)}
        hint={`${summary.invoices.totalCount.toLocaleString()} invoices`}
      />
      <StatTile
        label="Outstanding"
        value={formatCents(summary.invoices.outstandingCents)}
        hint="OPEN invoices"
        tone={summary.invoices.outstandingCents > 0 ? "warn" : "neutral"}
      />
    </section>
  );
}

function PlanBreakdown({ summary }: { summary: FinanceSummary }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-semibold text-white">MRR by plan</h2>
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] tracking-wider text-zinc-500 uppercase">
            <tr className="border-b border-zinc-800">
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3 text-right">Paying agencies</th>
              <th className="px-4 py-3 text-right">MRR (USD)</th>
            </tr>
          </thead>
          <tbody>
            {summary.mrr.byPlan.map((row) => (
              <tr key={row.plan} className="border-b border-zinc-800 last:border-0">
                <td className="px-4 py-3 font-mono text-[11.5px] tracking-wider text-zinc-300 uppercase">
                  {row.plan}
                </td>
                <td className="px-4 py-3 text-right text-zinc-200 tabular-nums">
                  {row.agencies.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right text-white tabular-nums">
                  {formatCents(row.mrrCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CurrencyBreakdown({ summary }: { summary: FinanceSummary }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-semibold text-white">MRR by currency</h2>
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] tracking-wider text-zinc-500 uppercase">
            <tr className="border-b border-zinc-800">
              <th className="px-4 py-3">Currency</th>
              <th className="px-4 py-3 text-right">Agencies</th>
              <th className="px-4 py-3 text-right">MRR (native)</th>
            </tr>
          </thead>
          <tbody>
            {summary.mrr.byCurrency.map((row) => (
              <tr key={row.currency} className="border-b border-zinc-800 last:border-0">
                <td className="px-4 py-3 font-mono text-[11.5px] text-zinc-300 uppercase">
                  {row.currency}
                </td>
                <td className="px-4 py-3 text-right text-zinc-200 tabular-nums">
                  {row.agencies.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right text-white tabular-nums">
                  {formatCents(row.mrrCents, row.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CohortTable({ summary }: { summary: FinanceSummary }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold text-white">Signup cohorts</h2>
        <span className="text-sm text-zinc-500">Last 12 months</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] tracking-wider text-zinc-500 uppercase">
            <tr className="border-b border-zinc-800">
              <th className="px-4 py-3">Cohort</th>
              <th className="px-4 py-3 text-right">Signups</th>
              <th className="px-4 py-3 text-right">Still paying</th>
              <th className="px-4 py-3 text-right">Retention</th>
              <th className="px-4 py-3 text-right">Current MRR</th>
            </tr>
          </thead>
          <tbody>
            {summary.cohorts.map((row) => {
              const retention =
                row.agencies === 0
                  ? null
                  : `${Math.round((row.payingAgencies / row.agencies) * 100)}%`;
              return (
                <tr key={row.monthIso} className="border-b border-zinc-800 last:border-0">
                  <td className="px-4 py-3 text-zinc-200">{formatMonthLabel(row.monthIso)}</td>
                  <td className="px-4 py-3 text-right text-zinc-200 tabular-nums">
                    {row.agencies}
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-200 tabular-nums">
                    {row.payingAgencies}
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-400 tabular-nums">
                    {retention ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-white tabular-nums">
                    {formatCents(row.currentMrrCents)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InvoiceFilters({
  initial,
}: {
  initial: {
    search: string | undefined;
    status: InvoiceStatusParam | undefined;
    createdFrom: string | undefined;
    createdTo: string | undefined;
    page: number;
  };
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-semibold text-white">Invoices</h2>
      <form
        method="get"
        className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 md:grid-cols-5"
      >
        <input
          type="text"
          name="search"
          placeholder="Agency name…"
          defaultValue={initial.search ?? ""}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
        />
        <select
          name="status"
          defaultValue={initial.status ?? ""}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        >
          <option value="">All statuses</option>
          {INVOICE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="date"
          name="createdFrom"
          defaultValue={initial.createdFrom ?? ""}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
        <input
          type="date"
          name="createdTo"
          defaultValue={initial.createdTo ?? ""}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
        <button
          type="submit"
          className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-100 hover:bg-red-500/20"
        >
          Apply
        </button>
      </form>
    </section>
  );
}

function InvoiceTable({
  rows,
  total,
  page,
  pageSize,
  filters,
}: {
  rows: InvoiceRowForRoot[];
  total: number;
  page: number;
  pageSize: number;
  filters: {
    search: string | undefined;
    status: InvoiceStatusParam | undefined;
    createdFrom: string | undefined;
    createdTo: string | undefined;
  };
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const startIdx = (page - 1) * pageSize;

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
        No invoices match these filters.
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] tracking-wider text-zinc-500 uppercase">
            <tr className="border-b border-zinc-800">
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Agency</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3">Links</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-800 last:border-0">
                <td className="px-4 py-3 font-mono text-[11.5px] text-zinc-400 tabular-nums">
                  {r.createdAt.toISOString().slice(0, 10)}
                </td>
                <td className="px-4 py-3 text-zinc-100">
                  <Link
                    href={`/root/agencies/${r.agencyId}`}
                    className="hover:text-white hover:underline"
                  >
                    {r.agencyName}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={r.status} />
                </td>
                <td className="px-4 py-3 text-right text-white tabular-nums">
                  {formatCents(r.amountCents, r.currency.toUpperCase())}
                </td>
                <td className="px-4 py-3 text-sm">
                  {r.hostedInvoiceUrl ? (
                    <a
                      href={r.hostedInvoiceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-sky-300 hover:underline"
                    >
                      Hosted ↗
                    </a>
                  ) : null}
                  {r.hostedInvoiceUrl && r.pdfUrl ? (
                    <span className="px-1 text-zinc-700">·</span>
                  ) : null}
                  {r.pdfUrl ? (
                    <a
                      href={r.pdfUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-sky-300 hover:underline"
                    >
                      PDF ↗
                    </a>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        pageCount={pageCount}
        total={total}
        startIdx={startIdx}
        rows={rows.length}
        filters={filters}
      />
    </section>
  );
}

function Pagination({
  page,
  pageCount,
  total,
  startIdx,
  rows,
  filters,
}: {
  page: number;
  pageCount: number;
  total: number;
  startIdx: number;
  rows: number;
  filters: {
    search: string | undefined;
    status: InvoiceStatusParam | undefined;
    createdFrom: string | undefined;
    createdTo: string | undefined;
  };
}) {
  const baseParams = new URLSearchParams();
  if (filters.search) baseParams.set("search", filters.search);
  if (filters.status) baseParams.set("status", filters.status);
  if (filters.createdFrom) baseParams.set("createdFrom", filters.createdFrom);
  if (filters.createdTo) baseParams.set("createdTo", filters.createdTo);

  const hrefFor = (p: number) => {
    const params = new URLSearchParams(baseParams);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/root/finance?${qs}` : "/root/finance";
  };

  return (
    <div className="flex items-center justify-between text-xs text-zinc-500">
      <span>
        Showing <span className="text-zinc-300">{startIdx + 1}</span>–
        <span className="text-zinc-300">{startIdx + rows}</span> of{" "}
        <span className="text-zinc-300">{total.toLocaleString()}</span>
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link
            href={hrefFor(page - 1)}
            className="rounded border border-zinc-700 px-2 py-1 hover:text-white"
          >
            ← Prev
          </Link>
        ) : (
          <span className="rounded border border-zinc-800 px-2 py-1 text-zinc-700">← Prev</span>
        )}
        <span className="font-mono text-[11px]">
          Page {page} / {pageCount}
        </span>
        {page < pageCount ? (
          <Link
            href={hrefFor(page + 1)}
            className="rounded border border-zinc-700 px-2 py-1 hover:text-white"
          >
            Next →
          </Link>
        ) : (
          <span className="rounded border border-zinc-800 px-2 py-1 text-zinc-700">Next →</span>
        )}
      </div>
    </div>
  );
}

function CsvLink({
  filters,
}: {
  filters: {
    search: string | undefined;
    status: InvoiceStatusParam | undefined;
    createdFrom: string | undefined;
    createdTo: string | undefined;
  };
}) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.status) params.set("status", filters.status);
  if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
  if (filters.createdTo) params.set("createdTo", filters.createdTo);
  const qs = params.toString();
  const href = qs ? `/api/root/finance/invoices.csv?${qs}` : "/api/root/finance/invoices.csv";

  return (
    <a
      href={href}
      className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:text-white"
    >
      Export CSV
    </a>
  );
}

function StatusPill({ status }: { status: InvoiceRowForRoot["status"] }) {
  const tone = STATUS_TONES[status];
  return (
    <span className={`rounded px-2 py-1 font-mono text-[10.5px] tracking-wider uppercase ${tone}`}>
      {status}
    </span>
  );
}

const STATUS_TONES: Record<InvoiceRowForRoot["status"], string> = {
  DRAFT: "bg-zinc-800 text-zinc-300",
  OPEN: "bg-amber-500/20 text-amber-200",
  PAID: "bg-emerald-500/20 text-emerald-200",
  VOID: "bg-zinc-800 text-zinc-500 line-through",
  UNCOLLECTIBLE: "bg-red-500/20 text-red-200",
};

function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "warn";
}) {
  const valueColor = tone === "warn" ? "text-amber-300" : "text-white";
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="font-mono text-[10.5px] tracking-wider text-zinc-500 uppercase">{label}</div>
      <div
        className={`font-display mt-2 text-3xl font-semibold tracking-tight tabular-nums ${valueColor}`}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-[11.5px] text-zinc-500">{hint}</div> : null}
    </div>
  );
}
