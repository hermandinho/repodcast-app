import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { GetStarted } from "@/components/dashboard/get-started";
import { Greeting } from "@/components/dashboard/greeting";
import { OutputVolumeChart } from "@/components/dashboard/output-volume-chart";
import { RecentEpisodes } from "@/components/dashboard/recent-episodes";
import { isLiveDb, getDashboardForUI, listClientsForUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { getAuthContext } from "@/server/auth/context";
import { prisma } from "@/server/db/client";

const MONTH_FMT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

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

  const { kpis, recent, chart, activity } = await getDashboardForUI(tenant);
  const [hero, ...rest] = kpis;

  const firstName = auth?.user.name?.split(" ")[0] ?? "Eli";
  const workspace = auth?.agency.name ?? "Northbeam Studio";

  return (
    <div className="flex min-h-full">
      {/* CONTENT */}
      <div className="min-w-0 flex-1 px-[30px] pt-[28px] pb-[60px]">
        {/* Greeting */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-6">
          <div>
            <Greeting firstName={firstName} />
            <p className="text-muted mt-[6px] text-[14px]">
              Here&apos;s what&apos;s moving across {workspace} ·{" "}
              <span className="text-muted-2">{MONTH_FMT.format(new Date())}</span>
            </p>
          </div>
        </div>

        {/* KPI tiles */}
        <div className="mb-[22px] grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* Hero KPI */}
          <div className="border-accent-border bg-accent-soft relative rounded-2xl border p-[18px]">
            <div className="text-accent mb-[14px] flex items-center gap-[6px] font-sans text-[11.5px] font-semibold">
              <svg
                width="13"
                height="13"
                viewBox="0 0 13 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 7l3 3 6-7" />
              </svg>
              {hero.label}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-accent text-[40px] leading-none font-bold tracking-[-1px]">
                {hero.value}
              </span>
              {hero.delta && (
                <span className="font-sans text-[12px] font-semibold text-[#1E7A47]">
                  {hero.delta}
                </span>
              )}
            </div>
            <div className="my-[14px] mb-[9px] h-[6px] overflow-hidden rounded-md bg-white">
              <div
                className="bg-accent h-full rounded-md"
                style={{ width: `${hero.progress ?? 0}%` }}
              />
            </div>
            <div className="text-muted text-[11.5px] leading-[1.4]">{hero.caption}</div>
          </div>

          {/* Plain KPIs */}
          {rest.map((k) => (
            <div key={k.label} className="border-border bg-surface rounded-2xl border p-[18px]">
              <div className="text-muted-2 mb-[14px] font-sans text-[12px] font-medium">
                {k.label}
              </div>
              <div className="font-display text-ink text-[34px] leading-none font-bold tracking-[-0.5px]">
                {k.value}
              </div>
              {k.delta && (
                <div className="mt-[11px] font-sans text-[12px] font-medium text-[#1E7A47]">
                  {k.delta}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Chart + Recent */}
        <div className="grid items-start gap-[18px] lg:grid-cols-2">
          <OutputVolumeChart series={chart} />
          <RecentEpisodes episodes={recent} />
        </div>
      </div>

      {/* ACTIVITY RAIL */}
      <aside
        className="border-border bg-surface-2 sticky top-0 hidden w-[312px] flex-shrink-0 self-start overflow-y-auto border-l px-[22px] py-6 pb-[60px] xl:block"
        style={{ maxHeight: "calc(100vh - var(--topbar-height))" }}
      >
        <ActivityFeed items={activity} />
      </aside>
    </div>
  );
}
