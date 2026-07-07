import Link from "next/link";
import type { SuggestionStatus, SuggestionType } from "@prisma/client";
import { requireSystemAdminContext } from "@/server/auth/system";
import {
  listSuggestions,
  SUGGESTION_STATUS_OPTIONS,
  SUGGESTION_TYPE_OPTIONS,
  type SuggestionRow,
} from "@/server/db/system/suggestions";
import { updateSuggestionStatusAction } from "./actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

const ERROR_COPY: Record<string, string> = {
  invalid: "Invalid input — check the required fields and formats.",
  invalid_status: "That status isn't a valid transition.",
  forbidden: "This action requires a ROOT or OPERATOR system role.",
  not_found: "The record you targeted no longer exists.",
  unknown: "Something went wrong. Check the server logs.",
};

function isStatusParam(v: string | undefined): v is SuggestionStatus {
  return v !== undefined && (SUGGESTION_STATUS_OPTIONS as readonly string[]).includes(v);
}
function isTypeParam(v: string | undefined): v is SuggestionType {
  return v !== undefined && (SUGGESTION_TYPE_OPTIONS as readonly string[]).includes(v);
}

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

export default async function RootFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    type?: string;
    agencyId?: string;
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
    status: isStatusParam(sp.status) ? sp.status : undefined,
    type: isTypeParam(sp.type) ? sp.type : undefined,
    agencyId: sp.agencyId?.trim() || undefined,
  };

  const { rows, total } = await listSuggestions(ctx, {
    ...filters,
    take: PAGE_SIZE,
    skip: (pageNum - 1) * PAGE_SIZE,
  });

  const openCount = rows.filter((r) => r.resolvedAt === null).length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white">Feedback</h1>
        <p className="mt-1 text-sm text-zinc-500">
          User-submitted suggestions from the dashboard&rsquo;s Feedback button. Every status change
          lands a{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[11px] text-zinc-300">
            SystemAuditLog
          </code>{" "}
          row in the same transaction. Terminal transitions (SHIPPED / WONTFIX) require a resolution
          note.
        </p>
      </header>

      {sp.error ? <Banner tone="error">{ERROR_COPY[sp.error] ?? ERROR_COPY.unknown}</Banner> : null}
      {sp.ok ? <Banner tone="ok">Change applied.</Banner> : null}

      <SuggestionsFilters filters={filters} />

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-lg font-semibold text-white">
            {total.toLocaleString()} {total === 1 ? "suggestion" : "suggestions"}
          </h2>
          <span className="font-mono text-[11px] text-zinc-500">{openCount} open on this page</span>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
            No suggestions match these filters yet.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <SuggestionCard key={r.id} row={r} canWrite={canWrite} />
            ))}
          </ul>
        )}

        <Pagination
          page={pageNum}
          pageCount={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          total={total}
          startIdx={(pageNum - 1) * PAGE_SIZE}
          rows={rows.length}
          filters={filters}
        />
      </section>
    </div>
  );
}

// ============================================================
// Filters
// ============================================================

function SuggestionsFilters({
  filters,
}: {
  filters: {
    status: SuggestionStatus | undefined;
    type: SuggestionType | undefined;
    agencyId: string | undefined;
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
        {SUGGESTION_STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select
        name="type"
        defaultValue={filters.type ?? ""}
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
      >
        <option value="">All types</option>
        {SUGGESTION_TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>
            {TYPE_LABEL[t]}
          </option>
        ))}
      </select>
      <input
        type="text"
        name="agencyId"
        placeholder="Agency id"
        defaultValue={filters.agencyId ?? ""}
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-500"
      />
      <button
        type="submit"
        className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-100 hover:bg-red-500/20"
      >
        Apply
      </button>
    </form>
  );
}

// ============================================================
// Suggestion card
// ============================================================

function SuggestionCard({ row, canWrite }: { row: SuggestionRow; canWrite: boolean }) {
  const isTerminal = row.status === "SHIPPED" || row.status === "WONTFIX";
  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-900/40">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={row.status} />
              <TypePill type={row.type} />
              <span className="truncate text-[13px] text-zinc-100">{row.title}</span>
            </div>
            <div className="truncate text-[12.5px] text-zinc-500">
              {row.reporterName ?? row.reporterEmail}
              {row.agency ? (
                <>
                  {" · "}
                  <Link
                    href={`/root/agencies/${row.agency.id}`}
                    className="hover:text-zinc-300 hover:underline"
                  >
                    {row.agency.name}
                  </Link>
                </>
              ) : null}
              {row.contextUrl ? (
                <>
                  {" · from "}
                  <code className="rounded bg-zinc-800 px-1 font-mono text-[10.5px] text-zinc-300">
                    {row.contextUrl}
                  </code>
                </>
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
          <div>
            <div className="mb-1 font-mono text-[10px] tracking-wider text-zinc-500 uppercase">
              Body
            </div>
            <pre className="max-h-72 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-zinc-300">
              {row.body}
            </pre>
          </div>

          {row.resolution ? (
            <div>
              <div className="mb-1 font-mono text-[10px] tracking-wider text-zinc-500 uppercase">
                Resolution{" "}
                {row.resolvedBy ? `by ${row.resolvedBy.name ?? row.resolvedBy.email}` : ""}
              </div>
              <p className="text-[12.5px] text-emerald-200">{row.resolution}</p>
            </div>
          ) : null}

          {canWrite ? (
            <div className="flex flex-col gap-3">
              {!isTerminal ? <ChangeStatusForm row={row} /> : null}
              <ResolveForm row={row} action="SHIPPED" />
              <ResolveForm row={row} action="WONTFIX" />
            </div>
          ) : (
            <WriteGateNotice />
          )}
        </div>
      </details>
    </li>
  );
}

function ChangeStatusForm({ row }: { row: SuggestionRow }) {
  const nextStates: readonly SuggestionStatus[] = ["NEW", "TRIAGED", "PLANNED", "IN_PROGRESS"];
  return (
    <form action={updateSuggestionStatusAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={row.id} />
      <select
        name="status"
        defaultValue={row.status}
        className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[12.5px] text-zinc-100"
      >
        {nextStates.map((s) => (
          <option key={s} value={s}>
            {s}
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
        Update status
      </button>
    </form>
  );
}

function ResolveForm({ row, action }: { row: SuggestionRow; action: "SHIPPED" | "WONTFIX" }) {
  const isShip = action === "SHIPPED";
  return (
    <form action={updateSuggestionStatusAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="status" value={action} />
      <input
        type="text"
        name="resolution"
        required
        minLength={3}
        placeholder={
          isShip ? "What we shipped (required)" : "Why we're not shipping this (required)"
        }
        className={`flex-1 rounded-md border bg-zinc-950 px-2 py-1.5 text-[12.5px] text-zinc-100 placeholder:text-zinc-500 ${
          isShip ? "border-emerald-900/60" : "border-zinc-700"
        }`}
      />
      <input
        type="text"
        name="note"
        placeholder="Audit note (optional)"
        className="w-40 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-[12.5px] text-zinc-100 placeholder:text-zinc-500"
      />
      <button
        type="submit"
        className={
          isShip
            ? "rounded border border-emerald-500/60 bg-emerald-500/10 px-3 py-1.5 text-[12.5px] font-medium text-emerald-100 hover:bg-emerald-500/20"
            : "rounded border border-zinc-700 px-3 py-1.5 text-[12.5px] text-zinc-300 hover:bg-zinc-800"
        }
      >
        {isShip ? "Mark shipped" : "Won't fix"}
      </button>
    </form>
  );
}

// ============================================================
// Pagination
// ============================================================

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
    status: SuggestionStatus | undefined;
    type: SuggestionType | undefined;
    agencyId: string | undefined;
  };
}) {
  if (total === 0) return null;
  const hrefFor = (p: number) => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.type) params.set("type", filters.type);
    if (filters.agencyId) params.set("agencyId", filters.agencyId);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/root/feedback?${qs}` : "/root/feedback";
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
// Building blocks
// ============================================================

const STATUS_TONES: Record<SuggestionStatus, string> = {
  NEW: "bg-amber-500/20 text-amber-200",
  TRIAGED: "bg-sky-500/20 text-sky-200",
  PLANNED: "bg-indigo-500/20 text-indigo-200",
  IN_PROGRESS: "bg-violet-500/20 text-violet-200",
  SHIPPED: "bg-emerald-500/20 text-emerald-200",
  WONTFIX: "bg-zinc-800 text-zinc-500",
};

const TYPE_LABEL: Record<SuggestionType, string> = {
  BUG: "Bug",
  FEATURE_REQUEST: "Feature",
  IMPROVEMENT: "Improvement",
  QUESTION: "Question",
  OTHER: "Other",
};

const TYPE_TONES: Record<SuggestionType, string> = {
  BUG: "bg-red-500/20 text-red-200",
  FEATURE_REQUEST: "bg-sky-500/20 text-sky-200",
  IMPROVEMENT: "bg-emerald-500/20 text-emerald-200",
  QUESTION: "bg-amber-500/20 text-amber-200",
  OTHER: "bg-zinc-800 text-zinc-400",
};

function StatusPill({ status }: { status: SuggestionStatus }) {
  return (
    <span
      className={`rounded px-2 py-0.5 font-mono text-[10.5px] tracking-wider uppercase ${STATUS_TONES[status]}`}
    >
      {status}
    </span>
  );
}

function TypePill({ type }: { type: SuggestionType }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] tracking-wider uppercase ${TYPE_TONES[type]}`}
    >
      {TYPE_LABEL[type]}
    </span>
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
      Your role can view but not act on suggestions. Ask a ROOT or OPERATOR to triage.
    </div>
  );
}
