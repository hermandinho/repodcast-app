import Link from "next/link";
import { requireSystemAdminContext } from "@/server/auth/system";
import {
  searchMembersForRoot,
  type MemberSearchMembership,
  type MemberSearchRow,
} from "@/server/db/system/users";
import { startImpersonationAction } from "@/app/(root)/root/agencies/[id]/impersonate-actions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

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

function formatIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function RootUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireSystemAdminContext();

  const pageNum = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const search = sp.search?.trim() || undefined;

  const canImpersonate = ctx.admin.role === "ROOT" || ctx.admin.role === "OPERATOR";

  const result = search
    ? await searchMembersForRoot(ctx, {
        search,
        take: PAGE_SIZE,
        skip: (pageNum - 1) * PAGE_SIZE,
      })
    : { rows: [], total: 0 };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white">Users</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Cross-agency member search. Email or name substring, or paste a Clerk{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[11px] text-zinc-300">
            user_…
          </code>{" "}
          id for an exact match. One row per distinct person; expand to see every agency membership.
        </p>
      </header>

      <SearchForm initial={search} />

      {!search ? (
        <EmptyHint />
      ) : (
        <Results
          rows={result.rows}
          total={result.total}
          page={pageNum}
          pageSize={PAGE_SIZE}
          search={search}
          canImpersonate={canImpersonate}
        />
      )}
    </div>
  );
}

// ============================================================
// Search form
// ============================================================

function SearchForm({ initial }: { initial: string | undefined }) {
  return (
    <form
      method="get"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4"
    >
      <input
        type="text"
        name="search"
        placeholder="email, name, or user_… clerkUserId"
        defaultValue={initial ?? ""}
        className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
      />
      <button
        type="submit"
        className="rounded-md border border-red-500/60 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-100 hover:bg-red-500/20"
      >
        Search
      </button>
    </form>
  );
}

function EmptyHint() {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
      Enter a search to look up a user across every agency.
    </div>
  );
}

// ============================================================
// Results
// ============================================================

function Results({
  rows,
  total,
  page,
  pageSize,
  search,
  canImpersonate,
}: {
  rows: MemberSearchRow[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  canImpersonate: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
        No users match <span className="font-mono text-zinc-300">&ldquo;{search}&rdquo;</span>.
      </div>
    );
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const startIdx = (page - 1) * pageSize;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold text-white">
          {total.toLocaleString()} {total === 1 ? "user" : "users"}
        </h2>
        <span className="text-sm text-zinc-500">
          Searched for <span className="font-mono text-zinc-300">&ldquo;{search}&rdquo;</span>
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <UserCard key={r.clerkUserId} row={r} canImpersonate={canImpersonate} />
        ))}
      </ul>
      <Pagination
        page={page}
        pageCount={pageCount}
        total={total}
        startIdx={startIdx}
        rows={rows.length}
        search={search}
      />
    </section>
  );
}

function UserCard({ row, canImpersonate }: { row: MemberSearchRow; canImpersonate: boolean }) {
  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-900/40">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="truncate text-sm text-zinc-100">{row.name ?? row.email}</span>
              {row.name ? (
                <span className="truncate text-[12px] text-zinc-500">{row.email}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2 text-[11.5px] text-zinc-500">
              <span>
                {row.memberships.length}{" "}
                {row.memberships.length === 1 ? "membership" : "memberships"}
              </span>
              <span>·</span>
              <span className="font-mono text-[10.5px] text-zinc-600">{row.clerkUserId}</span>
            </div>
          </div>
          <div className="flex flex-col items-end whitespace-nowrap">
            <span className="font-mono text-[11px] text-zinc-500">
              {formatRelative(row.lastActiveAt)}
            </span>
            <span className="font-mono text-[10.5px] text-zinc-600">
              last active {formatIsoDate(row.lastActiveAt)}
            </span>
          </div>
        </summary>

        <div className="border-t border-zinc-800">
          <ul className="flex flex-col divide-y divide-zinc-800">
            {row.memberships.map((m) => (
              <MembershipRow key={m.memberId} membership={m} canImpersonate={canImpersonate} />
            ))}
          </ul>
          <div className="flex justify-end border-t border-zinc-800 px-4 py-2">
            <Link
              href={`/root/users/${encodeURIComponent(row.clerkUserId)}`}
              className="text-[11.5px] font-semibold text-zinc-400 hover:text-zinc-100"
            >
              Full details + support actions →
            </Link>
          </div>
        </div>
      </details>
    </li>
  );
}

function MembershipRow({
  membership,
  canImpersonate,
}: {
  membership: MemberSearchMembership;
  canImpersonate: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <Link
          href={`/root/agencies/${membership.agencyId}`}
          className="truncate text-sm text-zinc-100 hover:text-white hover:underline"
        >
          {membership.agencyName}
        </Link>
        <div className="flex items-center gap-2 text-[11.5px] text-zinc-500">
          <span className="font-mono text-[10.5px] tracking-wider text-zinc-400 uppercase">
            {membership.role}
          </span>
          <span>·</span>
          <span className="font-mono text-[10.5px] tracking-wider text-zinc-500 uppercase">
            {membership.agencyPlan}
          </span>
          <span>·</span>
          <span>joined {formatIsoDate(membership.joinedAt)}</span>
          <span>·</span>
          <span>active {formatRelative(membership.lastActiveAt)}</span>
        </div>
      </div>
      {canImpersonate ? (
        <form action={startImpersonationAction}>
          <input type="hidden" name="agencyId" value={membership.agencyId} />
          <input type="hidden" name="memberId" value={membership.memberId} />
          <button
            type="submit"
            className="rounded border border-orange-500/60 px-3 py-1 text-[11.5px] font-semibold tracking-wider text-orange-300 uppercase hover:bg-orange-500/10"
            title="Open a read-only impersonation envelope for this membership"
          >
            Impersonate
          </button>
        </form>
      ) : null}
    </li>
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
  search,
}: {
  page: number;
  pageCount: number;
  total: number;
  startIdx: number;
  rows: number;
  search: string;
}) {
  const hrefFor = (p: number) => {
    const params = new URLSearchParams();
    params.set("search", search);
    if (p > 1) params.set("page", String(p));
    return `/root/users?${params.toString()}`;
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
