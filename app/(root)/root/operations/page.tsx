import Link from "next/link";
import { requireSystemAdminContext } from "@/server/auth/system";
import { getOperationsSummary, type OperationsSummary } from "@/server/db/system/operations";

export const dynamic = "force-dynamic";

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
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

export default async function RootOperationsPage() {
  const ctx = await requireSystemAdminContext();
  const summary = await getOperationsSummary(ctx);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
          Operations
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          AI spend, pipeline queue health, webhook deliveries — everything derivable from the DB
          without an external API. Inngest duration histograms + R2 storage + email deliverability
          live in follow-up slices.
        </p>
      </header>

      <SpendTiles spend={summary.aiSpend} />

      <ByModel spend={summary.aiSpend} />

      <TopAgencies spend={summary.aiSpend} />

      <QueueSection queue={summary.queue} />

      <WebhookSection webhooks={summary.webhooks} />
    </div>
  );
}

// ============================================================
// Sub-sections
// ============================================================

function SpendTiles({ spend }: { spend: OperationsSummary["aiSpend"] }) {
  return (
    <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <StatTile label="Today" value={formatCents(spend.todayCents)} hint="Since UTC midnight" />
      <StatTile label="Month to date" value={formatCents(spend.mtdCents)} />
      <StatTile
        label="Forecast EOM"
        value={formatCents(spend.forecastedMonthEndCents)}
        hint="Straight-line projection"
      />
      <StatTile
        label="Lifetime"
        value={formatCents(spend.lifetimeCents)}
        hint="All UsageLog rows"
      />
    </section>
  );
}

function ByModel({ spend }: { spend: OperationsSummary["aiSpend"] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-semibold text-white">MTD spend by model</h2>
      {spend.byModel.length === 0 ? (
        <EmptyState label="No UsageLog rows this month." />
      ) : (
        <Table>
          <thead className="text-[11px] tracking-wider text-zinc-500 uppercase">
            <tr className="border-b border-zinc-800">
              <th className="px-4 py-3">Model</th>
              <th className="px-4 py-3 text-right">Calls</th>
              <th className="px-4 py-3 text-right">Cost (USD)</th>
            </tr>
          </thead>
          <tbody>
            {spend.byModel.map((row) => (
              <tr key={row.model} className="border-b border-zinc-800 last:border-0">
                <td className="px-4 py-3 font-mono text-[11.5px] text-zinc-300">{row.model}</td>
                <td className="px-4 py-3 text-right text-zinc-200 tabular-nums">
                  {row.calls.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right text-white tabular-nums">
                  {formatCents(row.costCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}

function TopAgencies({ spend }: { spend: OperationsSummary["aiSpend"] }) {
  if (spend.topAgencies.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-semibold text-white">
          Top agencies by spend (MTD)
        </h2>
        <EmptyState label="No agencies have burned AI spend this month." />
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold text-white">
          Top agencies by spend (MTD)
        </h2>
        <span className="text-sm text-zinc-500">Top 20 · margin = monthly MRR − MTD cost</span>
      </div>
      <Table>
        <thead className="text-[11px] tracking-wider text-zinc-500 uppercase">
          <tr className="border-b border-zinc-800">
            <th className="px-4 py-3">Agency</th>
            <th className="px-4 py-3">Plan</th>
            <th className="px-4 py-3 text-right">Cost MTD</th>
            <th className="px-4 py-3 text-right">MRR</th>
            <th className="px-4 py-3 text-right">Margin MTD</th>
          </tr>
        </thead>
        <tbody>
          {spend.topAgencies.map((row) => (
            <tr key={row.agencyId} className="border-b border-zinc-800 last:border-0">
              <td className="px-4 py-3">
                <Link
                  href={`/root/agencies/${row.agencyId}`}
                  className="text-zinc-100 hover:text-white hover:underline"
                >
                  {row.agencyName}
                </Link>
              </td>
              <td className="px-4 py-3 font-mono text-[10.5px] tracking-wider text-zinc-400 uppercase">
                {row.plan}
              </td>
              <td className="px-4 py-3 text-right text-zinc-200 tabular-nums">
                {formatCents(row.costCentsMtd)}
              </td>
              <td className="px-4 py-3 text-right text-zinc-200 tabular-nums">
                {formatCents(row.mrrCentsMonthly)}
              </td>
              <td
                className={`px-4 py-3 text-right tabular-nums ${
                  row.marginCentsMtd < 0 ? "text-amber-300" : "text-emerald-300"
                }`}
              >
                {formatCents(row.marginCentsMtd)}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}

function QueueSection({ queue }: { queue: OperationsSummary["queue"] }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-semibold text-white">Pipeline queue</h2>
      <div className="grid grid-cols-3 gap-4">
        <StatTile
          label="In flight"
          value={queue.inFlightEpisodes.toLocaleString()}
          hint="Episodes status = PROCESSING"
        />
        <StatTile
          label="Failed 24h"
          value={queue.failedEpisodes24h.toLocaleString()}
          tone={queue.failedEpisodes24h > 0 ? "warn" : "neutral"}
        />
        <StatTile label="Failed lifetime" value={queue.failedEpisodesLifetime.toLocaleString()} />
      </div>

      <h3 className="font-display mt-2 text-base font-semibold text-white">Recent failures</h3>
      {queue.recentFailures.length === 0 ? (
        <EmptyState label="No failed episodes — pipeline is clean." />
      ) : (
        <ul className="flex flex-col gap-2">
          {queue.recentFailures.slice(0, 25).map((f) => (
            <li
              key={f.episodeId}
              className="flex items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm text-zinc-100">{f.episodeTitle}</span>
                <span className="text-[11.5px] text-zinc-500">
                  <Link
                    href={`/root/agencies/${f.agencyId}`}
                    className="hover:text-zinc-300 hover:underline"
                  >
                    {f.agencyName}
                  </Link>
                  {f.failureReason ? ` · ${f.failureReason}` : null}
                </span>
              </div>
              <span className="font-mono text-[10.5px] whitespace-nowrap text-zinc-500">
                {formatRelative(f.updatedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WebhookSection({ webhooks }: { webhooks: OperationsSummary["webhooks"] }) {
  const maxDaily = Math.max(1, ...webhooks.daily30d.map((d) => d.count));

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-lg font-semibold text-white">Webhooks</h2>
        <span className="text-sm text-zinc-500">Last 30 days</span>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="mb-3 text-[11px] tracking-wider text-zinc-500 uppercase">
          Daily delivery volume
        </div>
        <Sparkline data={webhooks.daily30d} max={maxDaily} />
      </div>

      {webhooks.bySource30d.length === 0 ? (
        <EmptyState label="No webhooks delivered in the last 30 days." />
      ) : (
        <Table>
          <thead className="text-[11px] tracking-wider text-zinc-500 uppercase">
            <tr className="border-b border-zinc-800">
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3 text-right">Deliveries (30d)</th>
            </tr>
          </thead>
          <tbody>
            {webhooks.bySource30d.map((row) => (
              <tr key={row.source} className="border-b border-zinc-800 last:border-0">
                <td className="px-4 py-3 font-mono text-[11.5px] text-zinc-300 uppercase">
                  {row.source}
                </td>
                <td className="px-4 py-3 text-right text-white tabular-nums">
                  {row.count.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}

// ============================================================
// Building blocks
// ============================================================

function Sparkline({ data, max }: { data: Array<{ dayIso: string; count: number }>; max: number }) {
  // Bare-bones inline-SVG bar sparkline. Width fills the parent; each bar
  // takes 1/30 of the width with a 1px gap.
  const width = 600;
  const height = 64;
  const barCount = data.length;
  const gap = 1;
  const barWidth = (width - gap * (barCount - 1)) / barCount;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-16 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label="Webhook deliveries per day, last 30 days"
    >
      {data.map((d, i) => {
        const h = Math.round((d.count / max) * (height - 4));
        const x = i * (barWidth + gap);
        const y = height - h;
        return (
          <rect
            key={d.dayIso}
            x={x}
            y={y}
            width={barWidth}
            height={Math.max(h, 1)}
            className="fill-emerald-500/80"
          >
            <title>
              {d.dayIso.slice(0, 10)} — {d.count.toLocaleString()}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/40">
      <table className="w-full min-w-[720px] text-left text-sm">{children}</table>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
      {label}
    </div>
  );
}

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
