import { requireSystemAdminContext } from "@/server/auth/system";
import {
  getSystemHealth,
  type HealthProbe,
  type HealthStatus,
  type SystemHealth,
} from "@/server/db/system/health";

export const dynamic = "force-dynamic";
// Refetch on every request — the health page is definitionally uncached.
export const revalidate = 0;

export default async function RootSystemPage() {
  const ctx = await requireSystemAdminContext();
  const health = await getSystemHealth(ctx);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
            System health
          </h1>
          <span className="font-mono text-[11px] text-zinc-500">
            Probes ran in {health.totalDurationMs}ms
          </span>
        </div>
        <p className="text-sm text-zinc-500">
          Live parallel reachability checks against every backing provider. Anthropic uses the
          freshest{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[11px] text-zinc-300">
            UsageLog.createdAt
          </code>{" "}
          as a proxy — we don&rsquo;t bill inference just to render this page. Latency-over-time
          sparklines land with the{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[11px] text-zinc-300">
            HealthProbe
          </code>{" "}
          table + 5-min Inngest ping cron.
        </p>
      </header>

      <TopBanner health={health} />

      <ProbeGrid probes={health.probes} />
    </div>
  );
}

// ============================================================
// Top-of-page banner
// ============================================================

function TopBanner({ health }: { health: SystemHealth }) {
  const tone = TOP_BANNER_TONES[health.worstStatus];
  const label = TOP_BANNER_LABELS[health.worstStatus];

  const downCount = health.probes.filter((p) => p.status === "down").length;
  const degradedCount = health.probes.filter((p) => p.status === "degraded").length;
  const unconfiguredCount = health.probes.filter((p) => p.status === "unconfigured").length;

  return (
    <div className={`rounded-xl border p-5 ${tone.container}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-center gap-3">
          <StatusDot status={health.worstStatus} size="lg" />
          <span className={`font-display text-lg font-semibold ${tone.text}`}>{label}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          {downCount > 0 ? <span className="text-red-300">{downCount} down</span> : null}
          {degradedCount > 0 ? (
            <span className="text-amber-300">{degradedCount} degraded</span>
          ) : null}
          {unconfiguredCount > 0 ? (
            <span className="text-zinc-500">{unconfiguredCount} unconfigured</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const TOP_BANNER_LABELS: Record<HealthStatus, string> = {
  ok: "All providers reachable",
  unconfigured: "Some providers unconfigured — no live incidents",
  degraded: "One or more providers degraded",
  down: "One or more providers unreachable",
};

const TOP_BANNER_TONES: Record<HealthStatus, { container: string; text: string }> = {
  ok: { container: "border-emerald-900/60 bg-emerald-950/30", text: "text-emerald-100" },
  unconfigured: { container: "border-zinc-800 bg-zinc-900/40", text: "text-zinc-200" },
  degraded: { container: "border-amber-900/60 bg-amber-950/30", text: "text-amber-100" },
  down: { container: "border-red-900/60 bg-red-950/30", text: "text-red-100" },
};

// ============================================================
// Probe grid
// ============================================================

function ProbeGrid({ probes }: { probes: HealthProbe[] }) {
  return (
    <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {probes.map((p) => (
        <ProbeCard key={p.service} probe={p} />
      ))}
    </section>
  );
}

function ProbeCard({ probe }: { probe: HealthProbe }) {
  const tone = TILE_TONES[probe.status];

  return (
    <article className={`flex flex-col gap-2 rounded-xl border p-5 ${tone.container}`}>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusDot status={probe.status} />
          <span className="font-display text-[15px] font-semibold text-white">{probe.label}</span>
        </div>
        <span className="font-mono text-[10.5px] tracking-wider text-zinc-500 uppercase">
          {probe.status}
        </span>
      </header>
      <p className={`text-[12.5px] ${tone.detail}`}>{probe.detail}</p>
      <footer className="flex items-center justify-between text-[11px] text-zinc-600">
        <span className="font-mono">{probe.latencyMs === null ? "—" : `${probe.latencyMs}ms`}</span>
        <span className="font-mono">{probe.service}</span>
      </footer>
    </article>
  );
}

const TILE_TONES: Record<HealthStatus, { container: string; detail: string }> = {
  ok: { container: "border-zinc-800 bg-zinc-900/40", detail: "text-zinc-400" },
  unconfigured: {
    container: "border-zinc-800/60 bg-zinc-900/20",
    detail: "text-zinc-500",
  },
  degraded: {
    container: "border-amber-900/60 bg-amber-950/20",
    detail: "text-amber-200",
  },
  down: { container: "border-red-900/60 bg-red-950/30", detail: "text-red-200" },
};

// ============================================================
// Status dot
// ============================================================

function StatusDot({ status, size = "sm" }: { status: HealthStatus; size?: "sm" | "lg" }) {
  const sizeClass = size === "lg" ? "h-3 w-3" : "h-2 w-2";
  const color = DOT_COLORS[status];
  return <span aria-label={status} className={`inline-block rounded-full ${sizeClass} ${color}`} />;
}

const DOT_COLORS: Record<HealthStatus, string> = {
  ok: "bg-emerald-400",
  unconfigured: "bg-zinc-600",
  degraded: "bg-amber-400",
  down: "bg-red-400",
};
