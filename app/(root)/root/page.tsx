import { prisma } from "@/server/db/client";
import { requireSystemAdminContext } from "@/server/auth/system";
import { getRootOverview } from "@/server/db/system/overview";
import { EpisodesBySourceChart, OutputsByPlanChart } from "@/components/root/overview-charts";

export const dynamic = "force-dynamic";

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function formatInt(n: number): string {
  return n.toLocaleString();
}

function formatRelativeIso(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default async function RootOverviewPage() {
  const ctx = await requireSystemAdminContext();

  // Overview + recent audit feed are independent — fetch in parallel.
  const [overview, recentAudit] = await Promise.all([
    getRootOverview(ctx),
    prisma.systemAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { bySystemAdmin: { select: { email: true, name: true } } },
    }),
  ]);

  const marginNegative = overview.usage.grossMarginCentsMtd < 0;
  const allSourcesZero = overview.charts.episodesBySource.every((s) => s.count === 0);
  const allWeeksZero = overview.charts.outputsByPlanLast12Weeks.every((w) => w.total === 0);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Platform overview
        </h1>
        <p className="text-sm text-zinc-400">
          Live aggregates, no rollup table yet. Cohort retention + the historic MRR series land with
          the financial dashboard (ship-order step 6); the snapshot-backed swap lands as step 4.
        </p>
      </header>

      {/* Money & growth */}
      <section className="flex flex-col gap-3">
        <SectionLabel>Money &amp; growth</SectionLabel>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-5">
          <Kpi
            label="MRR (USD)"
            value={formatCents(overview.money.mrrCents)}
            hint={`${overview.money.payingAgencies} paying · ${overview.money.nonPayingAgencies} non-paying`}
          />
          <Kpi label="ARR (USD)" value={formatCents(overview.money.arrCents)} hint="MRR × 12" />
          <Kpi
            label="Net new MRR (MTD)"
            value={formatCents(overview.money.netNewMrrMtdCents)}
            hint={`${overview.money.agenciesCreatedMtd} signups this month`}
          />
          <Kpi
            label="Gross margin (MTD)"
            value={formatCents(overview.usage.grossMarginCentsMtd)}
            hint={`MRR − AI spend · ${marginNegative ? "burning" : "covering"}`}
            tone={marginNegative ? "warning" : "ok"}
          />
          <Kpi label="Churn % (30d)" value="—" hint="Lands with step 6 (finance)" tone="muted" />
        </div>
      </section>

      {/* Usage */}
      <section className="flex flex-col gap-3">
        <SectionLabel>Usage</SectionLabel>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-5">
          <Kpi label="Agencies" value={formatInt(overview.usage.totalAgencies)} />
          <Kpi label="Members" value={formatInt(overview.usage.totalMembers)} />
          <Kpi label="Episodes (MTD)" value={formatInt(overview.usage.episodesMtd)} />
          <Kpi
            label="Outputs (MTD)"
            value={formatInt(overview.usage.outputsMtd)}
            hint="Current versions"
          />
          <Kpi
            label="AI spend (MTD)"
            value={formatCents(overview.usage.aiSpendCentsMtd)}
            hint="UsageLog.costCents sum"
          />
        </div>
      </section>

      {/* Health */}
      <section className="flex flex-col gap-3">
        <SectionLabel>Health</SectionLabel>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-5">
          <Kpi
            label="In-flight episodes"
            value={formatInt(overview.health.inFlightEpisodes)}
            hint="status = PROCESSING"
          />
          <Kpi
            label="Pipeline failures (24h)"
            value={formatInt(overview.health.pipelineFailures24h)}
            hint="OutputTransition → FAILED"
            tone={overview.health.pipelineFailures24h > 0 ? "warning" : "ok"}
          />
          <Kpi
            label="Failed episodes (lifetime)"
            value={formatInt(overview.health.failedEpisodesLifetime)}
            tone={overview.health.failedEpisodesLifetime > 0 ? "muted" : "ok"}
          />
          <Kpi
            label="Webhooks (24h)"
            value={formatInt(
              overview.health.webhookDeliveries24h.reduce((acc, r) => acc + r.count, 0),
            )}
            hint={
              overview.health.webhookDeliveries24h
                .map((r) => `${r.source}:${r.count}`)
                .join(" · ") || "no deliveries"
            }
          />
          <Kpi
            label="p95 gen latency"
            value="—"
            hint="Needs per-call duration tracking"
            tone="muted"
          />
        </div>
      </section>

      {/* Charts */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard
          title="Episodes by source"
          subtitle="Lifetime · how customers feed transcripts in"
        >
          {allSourcesZero ? (
            <EmptyChart message="No episodes have been processed yet." />
          ) : (
            <EpisodesBySourceChart data={overview.charts.episodesBySource} />
          )}
        </ChartCard>

        <ChartCard title="Outputs per week (12w)" subtitle="Stacked by agency plan at write time">
          {allWeeksZero ? (
            <EmptyChart message="No outputs generated in the last 12 weeks." />
          ) : (
            <OutputsByPlanChart data={overview.charts.outputsByPlanLast12Weeks} />
          )}
        </ChartCard>
      </section>

      {/* Recent platform-admin activity */}
      <section className="flex flex-col gap-3">
        <SectionLabel>Recent platform-admin activity</SectionLabel>
        {recentAudit.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-center text-sm text-zinc-500">
            No ROOT actions yet. Every platform-admin mutation will land here.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {recentAudit.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3"
              >
                <div className="flex flex-col">
                  <span className="font-mono text-[11.5px] tracking-wider text-zinc-300 uppercase">
                    {row.action}
                  </span>
                  <span className="text-[12.5px] text-zinc-500">
                    {row.bySystemAdmin.name ?? row.bySystemAdmin.email}
                    {row.targetAgencyId ? ` · agency ${row.targetAgencyId.slice(0, 8)}…` : null}
                    {row.note ? ` · ${row.note}` : null}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-zinc-500">
                  {formatRelativeIso(row.createdAt.toISOString())}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[10.5px] tracking-[0.18em] text-zinc-500 uppercase">
      {children}
    </h2>
  );
}

const TONE_STYLES = {
  ok: "border-zinc-800 bg-zinc-900/40",
  warning: "border-amber-900/60 bg-amber-950/30",
  muted: "border-zinc-800/60 bg-zinc-900/20",
} as const;

function Kpi({
  label,
  value,
  hint,
  tone = "ok",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: keyof typeof TONE_STYLES;
}) {
  return (
    <div className={`rounded-xl border p-5 ${TONE_STYLES[tone]}`}>
      <div className="font-mono text-[10.5px] tracking-wider text-zinc-500 uppercase">{label}</div>
      <div
        className={`font-display mt-2 text-2xl font-semibold tracking-tight tabular-nums ${
          tone === "warning" ? "text-amber-200" : tone === "muted" ? "text-zinc-500" : "text-white"
        }`}
      >
        {value}
      </div>
      {hint ? <div className="mt-1 text-[11px] text-zinc-500">{hint}</div> : null}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div>
        <div className="font-display text-[15px] font-semibold text-white">{title}</div>
        <div className="text-[12.5px] text-zinc-500">{subtitle}</div>
      </div>
      {children}
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-6 text-center text-[12.5px] text-zinc-500">
      {message}
    </div>
  );
}
