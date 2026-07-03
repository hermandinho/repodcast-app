import Link from "next/link";
import type { AbuseReportCategory, AbuseReportStatus } from "@prisma/client";
import { requireSystemAdminContext } from "@/server/auth/system";
import { listActiveSystemAdmins, type SystemAdminOption } from "@/server/db/system/audit";
import {
  ABUSE_REPORT_CATEGORY_OPTIONS,
  ABUSE_REPORT_STATUS_OPTIONS,
  listAbuseReports,
  listFlaggedOutputs,
  listFraudSignalCandidates,
  type AbuseReportRow,
  type FlaggedOutputRow,
  type FraudSignalRow,
} from "@/server/db/system/quality";
import {
  assignAbuseReportAction,
  createAbuseReportAction,
  dismissAbuseReportAction,
  resolveAbuseReportAction,
  unflagOutputAction,
} from "./actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function formatIsoDateTime(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 16);
}

function formatRelative(date: Date): string {
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

const ERROR_COPY: Record<string, string> = {
  invalid: "Invalid input — check the required fields and formats.",
  forbidden: "This action requires a ROOT or OPERATOR system role.",
  not_found: "The record you targeted no longer exists.",
  invalid_category: "Pick a category before creating the report.",
  unknown: "Something went wrong. Check the server logs.",
};

function isAbuseStatusParam(v: string | undefined): v is AbuseReportStatus {
  return v !== undefined && (ABUSE_REPORT_STATUS_OPTIONS as readonly string[]).includes(v);
}
function isAbuseCategoryParam(v: string | undefined): v is AbuseReportCategory {
  return v !== undefined && (ABUSE_REPORT_CATEGORY_OPTIONS as readonly string[]).includes(v);
}

export default async function RootQualityPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    category?: string;
    assignedTo?: string;
    page?: string;
    error?: string;
    ok?: string;
  }>;
}) {
  const sp = await searchParams;
  const ctx = await requireSystemAdminContext();

  const canWrite = ctx.admin.role === "ROOT" || ctx.admin.role === "OPERATOR";
  const pageNum = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const filters = {
    status: isAbuseStatusParam(sp.status) ? sp.status : undefined,
    category: isAbuseCategoryParam(sp.category) ? sp.category : undefined,
    assignedToSystemAdminId: sp.assignedTo?.trim() || undefined,
  };

  const [admins, reports, flags, fraudSignals] = await Promise.all([
    listActiveSystemAdmins(ctx),
    listAbuseReports(ctx, {
      ...filters,
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
    }),
    listFlaggedOutputs(ctx, { take: PAGE_SIZE, currentOnly: true }),
    listFraudSignalCandidates(ctx),
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
          Quality &amp; moderation
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Abuse-report triage queue plus a cross-agency list of flagged outputs. Every triage step —
          assign, resolve, dismiss, flag, unflag — lands a{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[11px] text-zinc-300">
            SystemAuditLog
          </code>{" "}
          row in the same transaction. Public{" "}
          <Link
            href="/legal/report"
            target="_blank"
            className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[11px] text-zinc-300 hover:text-white"
          >
            /legal/report
          </Link>{" "}
          takes external complaints; tenant-side output-flagging still lands in a follow-up slice.
        </p>
      </header>

      {sp.error ? <Banner tone="error">{ERROR_COPY[sp.error] ?? ERROR_COPY.unknown}</Banner> : null}
      {sp.ok ? <Banner tone="ok">Change applied.</Banner> : null}

      <AbuseReportsSection
        rows={reports.rows}
        total={reports.total}
        page={pageNum}
        pageSize={PAGE_SIZE}
        filters={filters}
        admins={admins}
        canWrite={canWrite}
      />

      <FlaggedOutputsSection rows={flags.rows} total={flags.total} canWrite={canWrite} />

      <FraudSignalsSection rows={fraudSignals} />
    </div>
  );
}

// ============================================================
// Anti-fraud signals
// ============================================================

const FRAUD_SIGNAL_COPY: Record<
  FraudSignalRow["signals"][number],
  { label: string; tone: string }
> = {
  young_high_spend_no_sub: {
    label: "High spend, no sub",
    tone: "bg-red-500/20 text-red-200 border-red-500/30",
  },
  disposable_email: {
    label: "Disposable email",
    tone: "bg-amber-500/20 text-amber-200 border-amber-500/30",
  },
  multi_agency_same_owner: {
    label: "Same owner, other agencies",
    tone: "bg-sky-500/20 text-sky-200 border-sky-500/30",
  },
};

function FraudSignalsSection({ rows }: { rows: FraudSignalRow[] }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-white">Anti-fraud signals</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Agencies matching at least one heuristic. This surface flags — it does not auto-suspend.
            Open the drilldown to review before acting.
          </p>
        </div>
        <span className="font-mono text-[11px] text-zinc-500">{rows.length} flagged</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
          Nothing suspicious right now.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/80 text-left font-mono text-[10.5px] tracking-wider text-zinc-500 uppercase">
              <tr>
                <th className="px-4 py-2 font-normal">Agency</th>
                <th className="px-4 py-2 font-normal">Owner</th>
                <th className="px-4 py-2 font-normal">Created</th>
                <th className="px-4 py-2 font-normal">Spend MTD</th>
                <th className="px-4 py-2 font-normal">Signals</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {rows.map((r) => (
                <tr key={r.agencyId} className="hover:bg-zinc-800/40">
                  <td className="px-4 py-3">
                    <Link
                      href={`/root/agencies/${r.agencyId}`}
                      className="text-white hover:underline"
                    >
                      {r.agencyName}
                    </Link>
                    <div className="font-mono text-[10.5px] text-zinc-500">{r.plan}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-zinc-200">{r.ownerName ?? r.ownerEmail ?? "—"}</div>
                    {r.ownerName && r.ownerEmail ? (
                      <div className="font-mono text-[10.5px] text-zinc-500">{r.ownerEmail}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-zinc-400 tabular-nums">
                    {formatRelative(r.createdAt)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    <span className={r.aiSpendCentsMtd >= 5000 ? "text-red-300" : "text-zinc-300"}>
                      ${(r.aiSpendCentsMtd / 100).toFixed(2)}
                    </span>
                    {!r.hasStripeSub ? (
                      <div className="font-mono text-[10.5px] text-amber-300">no sub</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {r.signals.map((s) => {
                        const meta = FRAUD_SIGNAL_COPY[s];
                        return (
                          <span
                            key={s}
                            className={`rounded-full border px-2 py-[2px] font-mono text-[10px] ${meta.tone}`}
                          >
                            {meta.label}
                          </span>
                        );
                      })}
                    </div>
                    {r.siblingAgencyIds.length > 0 ? (
                      <div className="mt-1 font-mono text-[10.5px] text-zinc-500">
                        also owns:{" "}
                        {r.siblingAgencyIds.map((id, i) => (
                          <span key={id}>
                            <Link
                              href={`/root/agencies/${id}`}
                              className="text-zinc-400 hover:text-zinc-200"
                            >
                              {id.slice(0, 8)}…
                            </Link>
                            {i < r.siblingAgencyIds.length - 1 ? ", " : ""}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ============================================================
// Abuse reports
// ============================================================

function AbuseReportsSection({
  rows,
  total,
  page,
  pageSize,
  filters,
  admins,
  canWrite,
}: {
  rows: AbuseReportRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: {
    status: AbuseReportStatus | undefined;
    category: AbuseReportCategory | undefined;
    assignedToSystemAdminId: string | undefined;
  };
  admins: SystemAdminOption[];
  canWrite: boolean;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold text-white">Abuse reports</h2>
        <span className="text-sm text-zinc-500">
          {total.toLocaleString()} {total === 1 ? "report" : "reports"}
        </span>
      </div>

      <AbuseReportsFilters admins={admins} filters={filters} />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
          No reports match these filters.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <AbuseReportCard key={r.id} row={r} admins={admins} canWrite={canWrite} />
          ))}
        </ul>
      )}

      <AbuseReportsPagination
        page={page}
        pageCount={Math.max(1, Math.ceil(total / pageSize))}
        total={total}
        startIdx={(page - 1) * pageSize}
        rows={rows.length}
        filters={filters}
      />

      {canWrite ? <CreateAbuseReportForm admins={admins} /> : <WriteGateNotice />}
    </section>
  );
}

function AbuseReportsFilters({
  admins,
  filters,
}: {
  admins: SystemAdminOption[];
  filters: {
    status: AbuseReportStatus | undefined;
    category: AbuseReportCategory | undefined;
    assignedToSystemAdminId: string | undefined;
  };
}) {
  return (
    <form
      method="get"
      className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 md:grid-cols-4"
    >
      <select
        name="status"
        defaultValue={filters.status ?? ""}
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
      >
        <option value="">All statuses</option>
        {ABUSE_REPORT_STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select
        name="category"
        defaultValue={filters.category ?? ""}
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
      >
        <option value="">All categories</option>
        {ABUSE_REPORT_CATEGORY_OPTIONS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        name="assignedTo"
        defaultValue={filters.assignedToSystemAdminId ?? ""}
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
      >
        <option value="">All assignees</option>
        {admins.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name ?? a.email} · {a.role}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-100 hover:bg-red-500/20"
      >
        Apply
      </button>
    </form>
  );
}

function AbuseReportCard({
  row,
  admins,
  canWrite,
}: {
  row: AbuseReportRow;
  admins: SystemAdminOption[];
  canWrite: boolean;
}) {
  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-900/40">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={row.status} />
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-zinc-300 uppercase">
                {row.category}
              </span>
              {row.targetAgencyName ? (
                <span className="text-[12.5px] text-zinc-400">
                  → <span className="text-zinc-200">{row.targetAgencyName}</span>
                </span>
              ) : null}
            </div>
            <div className="truncate text-[12.5px] text-zinc-500">
              {row.reportedByEmail ?? <em>anonymous / manual</em>}
              {row.assignedTo ? (
                <span>
                  {" · assigned to "}
                  <span className="text-zinc-300">
                    {row.assignedTo.name ?? row.assignedTo.email}
                  </span>
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col items-end whitespace-nowrap">
            <span className="font-mono text-[11px] text-zinc-500">
              {formatRelative(row.createdAt)}
            </span>
            <span className="font-mono text-[10.5px] text-zinc-600">
              {formatIsoDateTime(row.createdAt)}
            </span>
          </div>
        </summary>

        <div className="flex flex-col gap-4 border-t border-zinc-800 px-4 py-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <MetaBlock label="Target agency">
              {row.targetAgencyId ? (
                <Link
                  href={`/root/agencies/${row.targetAgencyId}`}
                  className="text-sky-300 hover:underline"
                >
                  {row.targetAgencyName ?? "(deleted agency)"} · {row.targetAgencyId}
                </Link>
              ) : (
                <span>—</span>
              )}
            </MetaBlock>
            <MetaBlock label="Target member" value={row.targetMemberId ?? "—"} />
            <MetaBlock label="Target output" value={row.targetOutputId ?? "—"} />
            <MetaBlock
              label="Resolved"
              value={row.resolvedAt ? formatIsoDateTime(row.resolvedAt) : "—"}
            />
          </div>

          <div>
            <div className="mb-1 font-mono text-[10px] tracking-wider text-zinc-500 uppercase">
              Body
            </div>
            <pre className="max-h-64 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-zinc-300">
              {row.body}
            </pre>
          </div>

          {row.resolution ? (
            <div>
              <div className="mb-1 font-mono text-[10px] tracking-wider text-zinc-500 uppercase">
                Resolution
              </div>
              <p className="text-[12.5px] text-emerald-200">{row.resolution}</p>
            </div>
          ) : null}

          {canWrite && row.status !== "RESOLVED" && row.status !== "DISMISSED" ? (
            <div className="flex flex-col gap-3">
              <AssignForm row={row} admins={admins} />
              <ResolveForm row={row} />
              <DismissForm row={row} />
            </div>
          ) : null}
        </div>
      </details>
    </li>
  );
}

function AssignForm({ row, admins }: { row: AbuseReportRow; admins: SystemAdminOption[] }) {
  return (
    <form action={assignAbuseReportAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={row.id} />
      <select
        name="assignedToSystemAdminId"
        defaultValue={row.assignedTo?.id ?? ""}
        className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[12.5px] text-zinc-100"
      >
        <option value="">Unassigned (returns to OPEN)</option>
        {admins.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name ?? a.email} · {a.role}
          </option>
        ))}
      </select>
      <input
        type="text"
        name="note"
        placeholder="Audit note (optional)"
        className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[12.5px] text-zinc-100 placeholder:text-zinc-500"
      />
      <button
        type="submit"
        className="rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-[12.5px] text-zinc-100 hover:bg-zinc-700"
      >
        Assign
      </button>
    </form>
  );
}

function ResolveForm({ row }: { row: AbuseReportRow }) {
  return (
    <form action={resolveAbuseReportAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={row.id} />
      <input
        type="text"
        name="resolution"
        required
        minLength={3}
        placeholder="Resolution — action taken (required)"
        className="flex-1 rounded-md border border-emerald-900/60 bg-zinc-950 px-2 py-1.5 text-[12.5px] text-zinc-100 placeholder:text-zinc-500"
      />
      <input
        type="text"
        name="note"
        placeholder="Audit note (optional)"
        className="w-40 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[12.5px] text-zinc-100 placeholder:text-zinc-500"
      />
      <button
        type="submit"
        className="rounded border border-emerald-500/60 bg-emerald-500/10 px-3 py-1.5 text-[12.5px] font-medium text-emerald-100 hover:bg-emerald-500/20"
      >
        Resolve
      </button>
    </form>
  );
}

function DismissForm({ row }: { row: AbuseReportRow }) {
  return (
    <form action={dismissAbuseReportAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={row.id} />
      <input
        type="text"
        name="note"
        required
        minLength={3}
        placeholder="Dismiss reason (required)"
        className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[12.5px] text-zinc-100 placeholder:text-zinc-500"
      />
      <button
        type="submit"
        className="rounded border border-zinc-700 px-3 py-1.5 text-[12.5px] text-zinc-300 hover:bg-zinc-800"
      >
        Dismiss
      </button>
    </form>
  );
}

function CreateAbuseReportForm({ admins }: { admins: SystemAdminOption[] }) {
  return (
    <form
      action={createAbuseReportAction}
      className="grid grid-cols-1 gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 md:grid-cols-6"
    >
      <h3 className="font-display text-sm font-semibold text-white md:col-span-6">
        Log a report manually
      </h3>
      <select
        name="category"
        required
        defaultValue=""
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
      >
        <option value="" disabled>
          Category
        </option>
        {ABUSE_REPORT_CATEGORY_OPTIONS.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input
        type="email"
        name="reportedByEmail"
        placeholder="Reporter email (optional)"
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 md:col-span-2"
      />
      <input
        type="text"
        name="targetAgencyId"
        placeholder="Target agency id (optional)"
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-500 md:col-span-2"
      />
      <select
        name="assignedToSystemAdminId"
        defaultValue=""
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
      >
        <option value="">Unassigned</option>
        {admins.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name ?? a.email}
          </option>
        ))}
      </select>
      <textarea
        name="body"
        required
        minLength={3}
        rows={4}
        placeholder="What the reporter said, or notes from a phoned-in complaint (required)"
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 md:col-span-6"
      />
      <input
        type="text"
        name="note"
        placeholder="Audit note (optional)"
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 md:col-span-5"
      />
      <button
        type="submit"
        className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-100 hover:bg-red-500/20"
      >
        Log report
      </button>
    </form>
  );
}

function AbuseReportsPagination({
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
    status: AbuseReportStatus | undefined;
    category: AbuseReportCategory | undefined;
    assignedToSystemAdminId: string | undefined;
  };
}) {
  if (total === 0) return null;

  const hrefFor = (p: number) => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.category) params.set("category", filters.category);
    if (filters.assignedToSystemAdminId) params.set("assignedTo", filters.assignedToSystemAdminId);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/root/quality?${qs}` : "/root/quality";
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

// ============================================================
// Flagged outputs
// ============================================================

function FlaggedOutputsSection({
  rows,
  total,
  canWrite,
}: {
  rows: FlaggedOutputRow[];
  total: number;
  canWrite: boolean;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold text-white">Flagged outputs</h2>
        <span className="text-sm text-zinc-500">
          {total.toLocaleString()} {total === 1 ? "flag" : "flags"} (current versions)
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
          No flagged outputs. Tenant-side flagging UI is Phase 4 polish; ROOT-side flagging lives on
          the agency drilldown&rsquo;s Episodes tab (future slice).
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <FlaggedOutputCard key={r.id} row={r} canWrite={canWrite} />
          ))}
        </ul>
      )}
    </section>
  );
}

function FlaggedOutputCard({ row, canWrite }: { row: FlaggedOutputRow; canWrite: boolean }) {
  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-900/40">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-amber-200 uppercase">
                {row.platform}
              </span>
              <span className="truncate text-sm text-zinc-100">{row.episodeTitle}</span>
              <span className="font-mono text-[10.5px] text-zinc-500">v{row.version}</span>
            </div>
            <div className="truncate text-[12.5px] text-zinc-500">
              <Link
                href={`/root/agencies/${row.agencyId}`}
                className="hover:text-zinc-300 hover:underline"
              >
                {row.agencyName}
              </Link>
              {" · "}
              {row.flagReason}
            </div>
          </div>
          <div className="flex flex-col items-end whitespace-nowrap">
            <span className="font-mono text-[11px] text-zinc-500">
              {formatRelative(row.flaggedAt)}
            </span>
            <span className="font-mono text-[10.5px] text-zinc-600">
              {formatIsoDateTime(row.flaggedAt)}
            </span>
          </div>
        </summary>
        <div className="border-t border-zinc-800 px-4 py-4">
          <div className="mb-1 font-mono text-[10px] tracking-wider text-zinc-500 uppercase">
            Content
          </div>
          <pre className="max-h-72 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-zinc-300">
            {row.content}
          </pre>

          {canWrite ? (
            <form action={unflagOutputAction} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="outputId" value={row.id} />
              <input
                type="text"
                name="note"
                required
                minLength={3}
                placeholder="Reason for unflagging (required)"
                className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[12.5px] text-zinc-100 placeholder:text-zinc-500"
              />
              <button
                type="submit"
                className="rounded border border-emerald-500/60 bg-emerald-500/10 px-3 py-1.5 text-[12.5px] font-medium text-emerald-100 hover:bg-emerald-500/20"
              >
                Clear flag
              </button>
            </form>
          ) : null}
        </div>
      </details>
    </li>
  );
}

// ============================================================
// Building blocks
// ============================================================

function StatusPill({ status }: { status: AbuseReportStatus }) {
  const tone = STATUS_TONES[status];
  return (
    <span
      className={`rounded px-2 py-0.5 font-mono text-[10.5px] tracking-wider uppercase ${tone}`}
    >
      {status}
    </span>
  );
}

const STATUS_TONES: Record<AbuseReportStatus, string> = {
  OPEN: "bg-amber-500/20 text-amber-200",
  IN_REVIEW: "bg-sky-500/20 text-sky-200",
  RESOLVED: "bg-emerald-500/20 text-emerald-200",
  DISMISSED: "bg-zinc-800 text-zinc-500",
};

function MetaBlock({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] tracking-wider text-zinc-500 uppercase">{label}</div>
      <div className="mt-1 truncate font-mono text-[11.5px] text-zinc-300">{children ?? value}</div>
    </div>
  );
}

function Banner({ tone, children }: { tone: "ok" | "error"; children: React.ReactNode }) {
  const cls =
    tone === "error"
      ? "border-red-900/60 bg-red-950/30 text-red-100"
      : "border-emerald-900/60 bg-emerald-950/30 text-emerald-100";
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${cls}`} role="status">
      {children}
    </div>
  );
}

function WriteGateNotice() {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 p-4 text-[12.5px] text-zinc-500">
      Your role can view but not act on reports. Ask a ROOT or OPERATOR to triage.
    </div>
  );
}
