import Link from "next/link";
import { requireSystemAdminContext } from "@/server/auth/system";
import {
  listActiveSystemAdmins,
  listSystemAuditEntries,
  SYSTEM_AUDIT_ACTION_OPTIONS,
  type SystemAdminOption,
  type SystemAuditRowForRoot,
} from "@/server/db/system/audit";
import type { SystemAuditAction } from "@/server/db/system/audit-actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function isKnownAuditAction(value: string | undefined): value is SystemAuditAction {
  return value !== undefined && (SYSTEM_AUDIT_ACTION_OPTIONS as readonly string[]).includes(value);
}

function formatIsoDateTime(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
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

type FilterState = {
  bySystemAdminId: string | undefined;
  action: SystemAuditAction | undefined;
  agencySearch: string | undefined;
  createdFrom: string | undefined;
  createdTo: string | undefined;
};

export default async function RootAuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    admin?: string;
    action?: string;
    agencySearch?: string;
    createdFrom?: string;
    createdTo?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const ctx = await requireSystemAdminContext();

  const pageNum = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const filters: FilterState = {
    bySystemAdminId: sp.admin?.trim() || undefined,
    action: isKnownAuditAction(sp.action) ? sp.action : undefined,
    agencySearch: sp.agencySearch?.trim() || undefined,
    createdFrom: sp.createdFrom || undefined,
    createdTo: sp.createdTo || undefined,
  };

  const [admins, entries] = await Promise.all([
    listActiveSystemAdmins(ctx),
    listSystemAuditEntries(ctx, {
      bySystemAdminId: filters.bySystemAdminId,
      action: filters.action,
      agencySearch: filters.agencySearch,
      createdFrom: filters.createdFrom,
      createdTo: filters.createdTo,
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
    }),
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white">Audit log</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Every ROOT-side mutation lands here inside the same transaction as the change itself.
          Read-only for every role, immutable by design — the ledger is constitutional.
        </p>
      </header>

      <Filters initial={filters} admins={admins} />

      <Table
        rows={entries.rows}
        total={entries.total}
        page={pageNum}
        pageSize={PAGE_SIZE}
        filters={filters}
      />
    </div>
  );
}

// ============================================================
// Filters
// ============================================================

function Filters({ initial, admins }: { initial: FilterState; admins: SystemAdminOption[] }) {
  return (
    <form
      method="get"
      className="grid grid-cols-1 gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 md:grid-cols-6"
    >
      <select
        name="admin"
        defaultValue={initial.bySystemAdminId ?? ""}
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
      >
        <option value="">All admins</option>
        {admins.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name ?? a.email} · {a.role}
          </option>
        ))}
      </select>

      <select
        name="action"
        defaultValue={initial.action ?? ""}
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 md:col-span-2"
      >
        <option value="">All actions</option>
        {SYSTEM_AUDIT_ACTION_OPTIONS.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>

      <input
        type="text"
        name="agencySearch"
        placeholder="Agency name…"
        defaultValue={initial.agencySearch ?? ""}
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
      />
      <input
        type="date"
        name="createdFrom"
        defaultValue={initial.createdFrom ?? ""}
        className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
      />
      <div className="flex gap-2 md:col-span-1">
        <input
          type="date"
          name="createdTo"
          defaultValue={initial.createdTo ?? ""}
          className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
        <button
          type="submit"
          className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-100 hover:bg-red-500/20"
        >
          Apply
        </button>
      </div>
    </form>
  );
}

// ============================================================
// Table
// ============================================================

function Table({
  rows,
  total,
  page,
  pageSize,
  filters,
}: {
  rows: SystemAuditRowForRoot[];
  total: number;
  page: number;
  pageSize: number;
  filters: FilterState;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
        No audit entries match these filters.
      </div>
    );
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const startIdx = (page - 1) * pageSize;

  return (
    <section className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <EntryCard key={r.id} row={r} />
        ))}
      </ul>
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

function EntryCard({ row }: { row: SystemAuditRowForRoot }) {
  const beforeJson = JSON.stringify(row.before, null, 2);
  const afterJson = JSON.stringify(row.after, null, 2);
  const hasSnapshots = row.before !== null || row.after !== null;
  const agencyLabel = row.targetAgency
    ? row.targetAgency.name || `agency ${row.targetAgency.id.slice(0, 8)}…`
    : null;

  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-900/40">
      {/*
        Nesting a link inside <summary> is invalid HTML — the anchor and the
        summary both claim the click. Keep the summary text-only; the
        drilldown link lives inside the details body under "Target".
      */}
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11.5px] tracking-wider text-zinc-300 uppercase">
                {row.action}
              </span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9.5px] tracking-wider text-zinc-400 uppercase">
                {row.admin.role}
              </span>
            </div>
            <div className="truncate text-[12.5px] text-zinc-500">
              <span className="text-zinc-300">{row.admin.name ?? row.admin.email}</span>
              {agencyLabel ? (
                <>
                  {" · "}
                  <span className="text-zinc-300">{agencyLabel}</span>
                </>
              ) : null}
              {row.note ? <span className="text-zinc-400"> · {row.note}</span> : null}
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

        <div className="grid grid-cols-1 gap-4 border-t border-zinc-800 px-4 py-4 text-[12px] md:grid-cols-2">
          <MetaBlock label="Actor" value={row.admin.email} />
          <MetaBlock label="Target">
            {row.targetAgency ? (
              <Link
                href={`/root/agencies/${row.targetAgency.id}`}
                className="text-sky-300 hover:underline"
              >
                {row.targetAgency.name || "(deleted agency)"} · {row.targetAgency.id}
              </Link>
            ) : row.targetEntityType && row.targetEntityId ? (
              <span>
                {row.targetEntityType} · {row.targetEntityId}
              </span>
            ) : (
              <span>—</span>
            )}
          </MetaBlock>
          <MetaBlock label="Target member" value={row.targetMemberId ?? "—"} />
          <MetaBlock label="IP" value={row.ipAddress ?? "—"} />
          <MetaBlock label="User agent" value={row.userAgent ?? "—"} full />

          {hasSnapshots ? (
            <div className="md:col-span-2">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <SnapshotBlock label="Before" json={beforeJson} />
                <SnapshotBlock label="After" json={afterJson} />
              </div>
            </div>
          ) : null}
        </div>
      </details>
    </li>
  );
}

function MetaBlock({
  label,
  value,
  full,
  children,
}: {
  label: string;
  value?: string;
  full?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <div className="font-mono text-[10px] tracking-wider text-zinc-500 uppercase">{label}</div>
      <div className="mt-1 truncate font-mono text-[11.5px] text-zinc-300">{children ?? value}</div>
    </div>
  );
}

function SnapshotBlock({ label, json }: { label: string; json: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] tracking-wider text-zinc-500 uppercase">{label}</div>
      <pre className="mt-1 max-h-64 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
        {json}
      </pre>
    </div>
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
  filters: FilterState;
}) {
  const hrefFor = (p: number) => {
    const params = new URLSearchParams();
    if (filters.bySystemAdminId) params.set("admin", filters.bySystemAdminId);
    if (filters.action) params.set("action", filters.action);
    if (filters.agencySearch) params.set("agencySearch", filters.agencySearch);
    if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
    if (filters.createdTo) params.set("createdTo", filters.createdTo);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/root/audit?${qs}` : "/root/audit";
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
