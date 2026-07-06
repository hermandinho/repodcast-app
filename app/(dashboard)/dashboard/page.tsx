import Link from "next/link";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { GetStarted } from "@/components/dashboard/get-started";
import { Greeting } from "@/components/dashboard/greeting";
import { OutputVolumeChart } from "@/components/dashboard/output-volume-chart";
import { RecentEpisodes } from "@/components/dashboard/recent-episodes";
import { isLiveDb, getDashboardForUI, listClientsForUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { getAuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";
import type { DashboardKpi } from "@/lib/sample-data/dashboard";

const MONTH_FMT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});
const DATE_BADGE_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

/**
 * Dashboard revamp (ref UI Revamp option 5a).
 *
 * Layout:
 *   1. Greeting + date badge (right-aligned mono chip).
 *   2. Attention strip (dark navy card) — only when outputs are pending
 *      review. Owns the "Review N outputs →" CTA that lands operators
 *      straight on the queue.
 *   3. Four equal KPI cards. Zero-value KPIs render a "NOT STARTED"
 *      pill + em-dash instead of pretending a real percentage exists.
 *   4. Two-column grid: output-volume chart | recent episodes.
 *   5. Full-width activity card at the bottom.
 *
 * The blue in the ref (`#2e5bff`) is only mockup color — every accent
 * on this page keeps the workspace's own `--color-accent` variable so
 * the dashboard stays cohesive with the rest of the app.
 */
export default async function DashboardPage() {
  const tenant = await resolveTenantContext();
  const auth = await getAuthContext();

  // Empty-state gate: live agencies with zero shows see the guided
  // onboarding card instead of a row of zero-valued KPIs. The card adapts
  // based on whether they have clients yet too. Sample-data mode always
  // renders the seeded demo data so the design preview stays representative
  // of a populated workspace.
  if (isLiveDb()) {
    const [clientCount, showCount] = await Promise.all([
      prisma.client.count({ where: { agencyId: tenant.agencyId } }),
      prisma.show.count({ where: { client: { agencyId: tenant.agencyId } } }),
    ]);
    if (showCount === 0) {
      const firstName = auth?.user.name?.split(" ")[0] ?? "there";
      const agencyName = auth?.agency.name ?? "your workspace";
      const clientOptions = (await listClientsForUI(tenant)).map((c) => ({
        id: c.key,
        name: c.name,
      }));
      return (
        <div className="min-w-0 flex-1 px-[30px] pt-[40px] pb-[60px]">
          <GetStarted
            agencyName={agencyName}
            firstName={firstName}
            clientCount={clientCount}
            showCount={showCount}
            clients={clientOptions}
          />
        </div>
      );
    }
  }

  const { kpis, recent, chart, activity, pendingReview } = await getDashboardForUI(tenant);
  const firstName = auth?.user.name?.split(" ")[0] ?? "Eli";
  const workspace = auth?.agency.name ?? "Northbeam Studio";
  const now = new Date();

  return (
    <div className="min-w-0 flex-1 bg-[#F6F8FC] px-4 pt-6 pb-14 sm:px-6 md:px-8 md:pt-7">
      <div className="mx-auto max-w-[1140px]">
        {/* Greeting + date badge */}
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <Greeting firstName={firstName} />
            <p className="mt-1 text-[14px] text-[#8A97AD]">
              What&apos;s moving across {workspace} · {MONTH_FMT.format(now)}
            </p>
          </div>
          <span className="font-mono text-[11px] tracking-[0.1em] text-[#8A97AD] uppercase">
            {DATE_BADGE_FMT.format(now)}
          </span>
        </div>

        {/* Attention strip — dark card that surfaces the review queue.
            Only rendered when there's actually something to review; a
            clean workspace shouldn't be nagged. */}
        {pendingReview > 0 && (
          <Link
            href="/episodes"
            className="mt-[22px] flex items-center gap-[18px] rounded-[12px] bg-[#0A1E3C] px-6 py-4 text-white no-underline hover:brightness-110"
          >
            <span
              className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] text-[16px]"
              style={{ background: "rgba(126,166,255,.18)", color: "#7EA6FF" }}
            >
              ◔
            </span>
            <div className="flex-1">
              <div className="text-[14.5px] font-bold">
                {pendingReview} output{pendingReview === 1 ? "" : "s"}{" "}
                {pendingReview === 1 ? "is" : "are"} waiting for your review
              </div>
              <div className="mt-[2px] text-[12.5px] text-[#A9B8D4]">
                Approving these trains the voice engine and starts your approval rate.
              </div>
            </div>
            <span className="bg-accent flex-none rounded-[8px] px-[18px] py-[10px] text-[13px] font-semibold text-white">
              Review outputs →
            </span>
          </Link>
        )}

        {/* KPI row — four equal cards. */}
        <div className="mt-4 grid grid-cols-1 gap-[14px] sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((k) => (
            <KpiCard key={k.label} kpi={k} />
          ))}
        </div>

        {/* Chart + recent episodes. Chart is slightly wider per ref
            (1.05fr / .95fr) — collapses to a single column below lg. */}
        <div className="mt-[14px] grid items-start gap-[14px] lg:grid-cols-[1.05fr_0.95fr]">
          <OutputVolumeChart series={chart} />
          <RecentEpisodes episodes={recent} />
        </div>

        {/* Activity — full width */}
        <div className="mt-[14px]">
          <ActivityFeed items={activity} />
        </div>
      </div>
    </div>
  );
}

/**
 * A single KPI tile. When the value is a zero-state ("—", "0", "0%")
 * we render the "NOT STARTED" pill + em-dash figure per the ref, plus
 * a caption pointing the operator at what unlocks the metric. Non-zero
 * KPIs render the number + delta pill in green.
 */
function KpiCard({ kpi }: { kpi: DashboardKpi }) {
  const isZeroState = isZeroValue(kpi.value);
  const captionFallback = fallbackCaption(kpi.label);

  return (
    <div className="rounded-[12px] border border-[#E4E9F1] bg-white px-[22px] py-5">
      <div className="flex items-baseline justify-between">
        <span className="text-[12.5px] font-semibold text-[#41506B]">{kpi.label}</span>
        {isZeroState && (
          <span className="rounded-full bg-[#F1F4F9] px-[7px] py-[2px] font-mono text-[9.5px] tracking-[0.08em] text-[#8A97AD] uppercase">
            NOT STARTED
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-[10px]">
        <span
          className={`text-[34px] leading-none font-extrabold tracking-[-0.02em] ${
            isZeroState ? "text-[#B0BACB]" : "text-[#0A1E3C]"
          }`}
        >
          {isZeroState ? "—" : kpi.value}
        </span>
        {!isZeroState && kpi.delta && (
          <span className="text-[12px] font-semibold text-[#1F8A5B]">{kpi.delta}</span>
        )}
      </div>
      <div className="mt-2 text-[12px] text-[#8A97AD]">
        {isZeroState ? captionFallback : (kpi.caption ?? captionFallback)}
      </div>
    </div>
  );
}

/** Match the ref's "NOT STARTED" behavior — em-dash for missing metrics. */
function isZeroValue(v: string): boolean {
  const trimmed = v.trim();
  return trimmed === "" || trimmed === "—" || trimmed === "0" || trimmed === "0%";
}

/**
 * When a KPI has no caption from the data source, fall back to a
 * label-specific hint that explains what unlocks the metric. Prevents
 * an ugly empty line under the zero-state figure.
 */
function fallbackCaption(label: string): string {
  switch (label) {
    case "Posted with no edits":
      return "The clearest sign the voice engine is working";
    case "Approval rate":
      return "Starts counting after your first review";
    case "Episodes this month":
      return "New episodes count here as you create them";
    case "Outputs generated":
      return "Every generated post lands here";
    default:
      return "";
  }
}
