import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MemberRole, type ClientStatement } from "@prisma/client";
import { GenerateStatementForm } from "@/components/clients/generate-statement-form";
import { listClientStatements } from "@/server/db/client-statements";
import { sumStatementItemsForMany } from "@/server/db/client-statement-items";
import { getClientForUI, isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";

/**
 * Client statements list.
 *
 * OWNER/ADMIN only — statements are billing material. EDITOR/REVIEWER hit
 * the URL → redirected back to the client overview.
 */
const PAGE_SIZE = 25;

function parsePage(raw: string | string[] | undefined): number {
  if (typeof raw !== "string") return 1;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

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

function currentMonthBoundaries(): { start: string; end: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return { start: dateOnly(first), end: dateOnly(now) };
}

export default async function ClientStatementsListPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { key } = await params;
  const sp = await searchParams;
  const tenant = await resolveTenantContext();
  if (tenant.role !== MemberRole.OWNER && tenant.role !== MemberRole.ADMIN) {
    redirect(`/clients/${key}`);
  }

  const client = await getClientForUI(tenant, key);
  if (!client) notFound();

  const page = parsePage(sp.page);

  // Sample-data mode: no statements stored yet. Show an empty list + the
  // Generate form (which short-circuits to a synthetic id in the action).
  const list = isLiveDb()
    ? await listClientStatements(tenant, client.key, {
        take: PAGE_SIZE,
        skip: (page - 1) * PAGE_SIZE,
      })
    : { rows: [] as ClientStatement[], total: 0 };

  // One aggregate query for the whole page — avoids N+1 sums on the
  // items relation. Missing key ⇒ 0 (no items yet on a fresh statement).
  const totalsByStatement = isLiveDb()
    ? await sumStatementItemsForMany(list.rows.map((s) => s.id))
    : new Map<string, number>();

  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const startN = list.total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endN = Math.min(list.total, page * PAGE_SIZE);
  const monthBoundaries = currentMonthBoundaries();

  return (
    <div className="flex flex-col gap-5">
      <GenerateStatementForm
        clientKey={client.key}
        defaultStart={monthBoundaries.start}
        defaultEnd={monthBoundaries.end}
      />

      <section className="border-border bg-surface rounded-3xl border p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="font-display text-ink text-[15px] font-semibold">Past statements</div>
            <div className="text-muted-2 mt-[3px] text-[12.5px]">
              {list.total === 0
                ? "No statements yet — generate one above."
                : `${list.total} statement${list.total === 1 ? "" : "s"} · showing ${startN}–${endN}`}
            </div>
          </div>
        </div>

        {list.rows.length === 0 ? (
          <div className="border-border bg-canvas text-muted-2 rounded-2xl border border-dashed px-4 py-8 text-center text-[12.5px]">
            Statements you generate will appear here. Snapshots are immutable — re-running a period
            creates a new row.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.rows.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/clients/${client.key}/statements/${s.id}`}
                  className="border-border-subtle bg-surface-2 hover:border-border-2 flex flex-wrap items-center gap-4 rounded-2xl border px-4 py-[12px] transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-display text-ink text-[14px] font-semibold">
                        {formatShortDate(s.periodStart)} → {formatShortDate(s.periodEnd)}
                      </div>
                      {s.sharedWithPortalAt && (
                        <span
                          className="inline-flex items-center gap-[5px] rounded-full border border-emerald-200 bg-emerald-50 px-2 py-[2px] text-[10.5px] font-medium text-emerald-800"
                          title={`Shared with client portal on ${formatShortDate(s.sharedWithPortalAt)}`}
                        >
                          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Shared
                        </span>
                      )}
                    </div>
                    <div className="text-muted-2 mt-[3px] text-[12px]">
                      {s.episodeCount} episode
                      {s.episodeCount === 1 ? "" : "s"} · {s.outputCount} output
                      {s.outputCount === 1 ? "" : "s"} · {s.approvalRatePct}% approval rate
                    </div>
                  </div>
                  <span className="text-ink font-sans text-[13px] font-semibold">
                    {formatCurrency(totalsByStatement.get(s.id) ?? 0, s.currency)}
                  </span>
                  <span className="text-muted-2 text-[11.5px]">
                    Generated {formatShortDate(s.generatedAt)}
                  </span>
                  <span className="text-accent font-sans text-[12.5px] font-semibold">View →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {totalPages > 1 && (
          <nav className="text-muted mt-4 flex items-center justify-between gap-3 text-[12.5px]">
            <Link
              href={`/clients/${client.key}/statements${page > 1 ? `?page=${page - 1}` : ""}`}
              className={`border-border rounded-md border bg-white px-3 py-2 font-medium ${
                page <= 1 ? "pointer-events-none opacity-50" : "hover:text-accent"
              }`}
            >
              ← Previous
            </Link>
            <span>
              Page <span className="text-ink font-semibold">{page}</span> of {totalPages}
            </span>
            <Link
              href={`/clients/${client.key}/statements?page=${page + 1}`}
              className={`border-border rounded-md border bg-white px-3 py-2 font-medium ${
                page >= totalPages ? "pointer-events-none opacity-50" : "hover:text-accent"
              }`}
            >
              Next →
            </Link>
          </nav>
        )}
      </section>
    </div>
  );
}
