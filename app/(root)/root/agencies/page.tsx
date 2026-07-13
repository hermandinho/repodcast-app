import Link from "next/link";
import { Plan } from "@prisma/client";
import { AgencyFilters } from "@/components/root/agency-filters";
import { requireSystemAdminContext } from "@/server/auth/system";
import { listAgenciesForRoot } from "@/server/db/system/agencies";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

function parsePage(raw: string | string[] | undefined): number {
  if (typeof raw !== "string") return 1;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseString(raw: string | string[] | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parsePlan(raw: string | string[] | undefined): Plan | undefined {
  if (typeof raw !== "string") return undefined;
  return raw in Plan ? (raw as Plan) : undefined;
}

function parseStatus(raw: string | string[] | undefined): "active" | "suspended" | undefined {
  if (raw === "active" || raw === "suspended") return raw;
  return undefined;
}

function parseTrial(
  raw: string | string[] | undefined,
): "active" | "converted" | "expired" | "canceled" | undefined {
  if (raw === "active" || raw === "converted" || raw === "expired" || raw === "canceled") {
    return raw;
  }
  return undefined;
}

function parseDate(raw: string | string[] | undefined): Date | undefined {
  const s = parseString(raw);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function formatRelative(date: Date | null): string {
  if (!date) return "—";
  const diffMs = Date.now() - date.getTime();
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

const PLAN_STYLE: Record<Plan, string> = {
  SOLO: "bg-slate-700/40 text-slate-200 ring-slate-500/40",
  STUDIO: "bg-accent/20 text-accent-soft ring-accent/40",
  AGENCY: "bg-violet-500/20 text-violet-200 ring-violet-400/40",
  NETWORK: "bg-emerald-500/20 text-emerald-200 ring-emerald-400/40",
};

export default async function RootAgenciesListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireSystemAdminContext();
  const params = await searchParams;

  const page = parsePage(params.page);
  const search = parseString(params.q);
  const plan = parsePlan(params.plan);
  const status = parseStatus(params.status);
  const trial = parseTrial(params.trial);
  const createdFrom = parseDate(params.from);
  const createdTo = parseDate(params.to);

  const { rows, total } = await listAgenciesForRoot(ctx, {
    search,
    plan,
    status: status ?? "all",
    trial: trial ?? "all",
    createdFrom,
    createdTo,
    take: PAGE_SIZE,
    skip: (page - 1) * PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isFiltered = Boolean(search || plan || status || trial || createdFrom || createdTo);

  const linkFor = (nextPage: number) => {
    const qp = new URLSearchParams();
    if (search) qp.set("q", search);
    if (plan) qp.set("plan", plan);
    if (status) qp.set("status", status);
    if (trial) qp.set("trial", trial);
    if (typeof params.from === "string") qp.set("from", params.from);
    if (typeof params.to === "string") qp.set("to", params.to);
    if (nextPage > 1) qp.set("page", String(nextPage));
    const qs = qp.toString();
    return qs ? `/root/agencies?${qs}` : "/root/agencies";
  };

  const deletedName = parseString(params.deleted);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Agencies
          </h1>
          <p className="text-sm text-zinc-400">
            {total.toLocaleString()} {total === 1 ? "agency" : "agencies"}
            {isFiltered ? " match the current filters" : " in the system"}.
          </p>
        </div>
      </header>

      {deletedName ? (
        <div className="rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
          Agency <span className="font-semibold">{deletedName}</span> was permanently deleted. R2
          objects were quarantined; the audit row survives.
        </div>
      ) : null}

      <AgencyFilters />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-10 text-center text-sm text-zinc-500">
          {isFiltered
            ? "No agencies match the current filters."
            : "No agencies have signed up yet."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-zinc-900/80 font-mono text-[10px] tracking-wider text-zinc-500 uppercase">
              <tr>
                <Th>Agency</Th>
                <Th>Plan</Th>
                <Th>Trial</Th>
                <Th className="text-right">Members</Th>
                <Th className="text-right">Episodes MTD</Th>
                <Th className="text-right">Outputs MTD</Th>
                <Th className="text-right">Cost MTD</Th>
                <Th>Last activity</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-zinc-800 transition-colors hover:bg-zinc-800/40"
                >
                  <Td>
                    <Link
                      href={`/root/agencies/${row.id}`}
                      className="hover:text-accent flex flex-col text-zinc-100 transition-colors"
                    >
                      <span className="font-medium">{row.name}</span>
                      <span className="text-[11.5px] text-zinc-500">
                        {row.ownerEmail ?? "no owner"}
                      </span>
                    </Link>
                  </Td>
                  <Td>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-[2px] font-mono text-[10.5px] font-semibold tracking-wider uppercase ring-1 ${PLAN_STYLE[row.plan]}`}
                    >
                      {row.plan}
                    </span>
                  </Td>
                  <Td>
                    <TrialCell status={row.trialStatus} trialEndsAt={row.trialEndsAt} />
                  </Td>
                  <Td className="text-right text-zinc-100 tabular-nums">{row.memberCount}</Td>
                  <Td className="text-right text-zinc-100 tabular-nums">{row.episodesMtd}</Td>
                  <Td className="text-right text-zinc-100 tabular-nums">{row.outputsMtd}</Td>
                  <Td className="text-right text-zinc-100 tabular-nums">
                    {formatCents(row.costCentsMtd)}
                  </Td>
                  <Td className="text-zinc-400">{formatRelative(row.lastActivityAt)}</Td>
                  <Td className="font-mono text-[11.5px] text-zinc-500">
                    {row.createdAt.toISOString().slice(0, 10)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <nav className="flex items-center justify-between text-sm text-zinc-500">
          <span>
            Page {page} of {totalPages} · {total.toLocaleString()} total
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={linkFor(page - 1)}
                className="rounded-md border border-zinc-700 px-3 py-1 text-zinc-200 hover:bg-zinc-800"
              >
                ← Prev
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                href={linkFor(page + 1)}
                className="rounded-md border border-zinc-700 px-3 py-1 text-zinc-200 hover:bg-zinc-800"
              >
                Next →
              </Link>
            ) : null}
          </div>
        </nav>
      )}
    </div>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 ${className}`}>{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className}`}>{children}</td>;
}

const TRIAL_STYLE: Record<
  "NONE" | "ACTIVE" | "CONVERTED" | "EXPIRED" | "CANCELED",
  { bg: string; label: (endsAt: Date | null) => string }
> = {
  NONE: { bg: "text-zinc-600", label: () => "—" },
  ACTIVE: {
    bg: "bg-emerald-500/20 text-emerald-200 ring-emerald-400/40",
    label: (endsAt) => {
      if (!endsAt) return "on trial";
      const days = Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / 86_400_000));
      return days === 0 ? "ends today" : `${days}d left`;
    },
  },
  CONVERTED: {
    bg: "bg-accent/20 text-accent-soft ring-accent/40",
    label: () => "converted",
  },
  EXPIRED: {
    bg: "bg-red-500/20 text-red-200 ring-red-400/40",
    label: () => "expired",
  },
  CANCELED: {
    bg: "bg-zinc-700/50 text-zinc-300 ring-zinc-600/40",
    label: () => "canceled",
  },
};

function TrialCell({
  status,
  trialEndsAt,
}: {
  status: "NONE" | "ACTIVE" | "CONVERTED" | "EXPIRED" | "CANCELED";
  trialEndsAt: Date | null;
}) {
  const cfg = TRIAL_STYLE[status];
  if (status === "NONE") return <span className={cfg.bg}>—</span>;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-[2px] font-mono text-[10.5px] font-semibold tracking-wider uppercase ring-1 ${cfg.bg}`}
    >
      {cfg.label(trialEndsAt)}
    </span>
  );
}
