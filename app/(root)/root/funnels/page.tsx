import { requireSystemAdminContext } from "@/server/auth/system";
import { countEvent, isPostHogConfigured } from "@/server/analytics/posthog-query";
import { countSignupsByCampaign, countSignupsBySource } from "@/server/db/attribution";
import { prisma } from "@/server/db/client";

/**
 * Acquisition funnel view.
 *
 * Two data planes:
 *
 *   1. **Our DB** — signups per period + attribution breakdown by
 *      utm_source / utm_campaign. Always renders because it's queried
 *      from Postgres (no external dep).
 *
 *   2. **PostHog** — event counts up the funnel
 *      (`landing_hero_viewed → pricing_viewed → signup_started →
 *      agency_created → onboarding_step_completed → first_output_approved
 *      → trial_started → trial_converted`). Renders only when
 *      `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID` are set. When
 *      unset, the section shows a "PostHog not configured" note with
 *      wiring instructions.
 *
 * Both planes look at the same 30-day rolling window ending now.
 */
export const dynamic = "force-dynamic";

const FUNNEL_STEPS: ReadonlyArray<{ event: string; label: string }> = [
  { event: "landing_hero_viewed", label: "Landing hero viewed" },
  { event: "pricing_viewed", label: "Pricing viewed" },
  { event: "signup_started", label: "Sign-up started" },
  { event: "agency_created", label: "Signup completed (agency created)" },
  { event: "onboarding_step_completed", label: "Onboarding step completed" },
  { event: "first_output_approved", label: "First output approved" },
  { event: "trial_started", label: "Trial activated" },
  { event: "trial_converted", label: "Trial converted (paid)" },
];

export default async function RootFunnelsPage() {
  await requireSystemAdminContext();

  const now = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Always available — Postgres side.
  const [signupsInWindow, bySource, byCampaign] = await Promise.all([
    prisma.agency.count({ where: { createdAt: { gte: from, lt: now } } }),
    countSignupsBySource(from, now),
    countSignupsByCampaign(from, now),
  ]);

  // Optional — PostHog side. Fires in parallel; each returns null when
  // the token isn't set.
  const posthogConfigured = isPostHogConfigured();
  const funnelCounts = posthogConfigured
    ? await Promise.all(FUNNEL_STEPS.map((s) => countEvent(s.event, from, now)))
    : FUNNEL_STEPS.map(() => null);

  const topStep = firstNonZero(funnelCounts);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Acquisition funnel
        </h1>
        <p className="text-sm text-zinc-400">
          Rolling 30-day window · signups sourced from our DB, event counts from PostHog. See Q2.md
          §&ldquo;Weeks 14–16&rdquo; for the source taxonomy and the funnel step definitions.
        </p>
      </header>

      {/* KPIs — always-on numbers from Postgres */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi
          label="Signups (30d)"
          value={signupsInWindow.toLocaleString()}
          hint="Agencies created"
        />
        <Kpi
          label="Attributed"
          value={bySource
            .filter((r) => r.source !== "direct")
            .reduce((n, r) => n + r.count, 0)
            .toLocaleString()}
          hint="With utm_source set"
        />
        <Kpi
          label="Direct"
          value={bySource.find((r) => r.source === "direct")?.count.toLocaleString() ?? "0"}
          hint="No utm / no referrer"
        />
        <Kpi
          label="PostHog"
          value={posthogConfigured ? "Live" : "Not wired"}
          hint={
            posthogConfigured
              ? "Personal API key set"
              : "Set POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID"
          }
          tone={posthogConfigured ? "ok" : "muted"}
        />
      </section>

      {/* Funnel steps */}
      <section className="flex flex-col gap-3">
        <SectionLabel>Funnel steps · last 30 days</SectionLabel>
        {!posthogConfigured && (
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/30 p-3 text-[13px] text-amber-200">
            PostHog Personal API Key not configured. Set{" "}
            <code className="rounded bg-black/30 px-1.5 py-0.5 text-[12px]">
              POSTHOG_PERSONAL_API_KEY
            </code>{" "}
            and{" "}
            <code className="rounded bg-black/30 px-1.5 py-0.5 text-[12px]">
              POSTHOG_PROJECT_ID
            </code>{" "}
            in the environment to populate this section. See docs/observability.md.
          </div>
        )}
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-900/70 text-xs tracking-wider text-zinc-500 uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Step</th>
                <th className="px-4 py-3 text-right font-medium">Count</th>
                <th className="px-4 py-3 text-right font-medium">vs top</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {FUNNEL_STEPS.map((step, i) => {
                const count = funnelCounts[i];
                const pct =
                  count !== null && topStep !== null && topStep > 0
                    ? (count / topStep) * 100
                    : null;
                return (
                  <tr key={step.event} className="hover:bg-zinc-900/30">
                    <td className="px-4 py-3">
                      <div className="text-zinc-200">{step.label}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-zinc-500">{step.event}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-100">
                      {count === null ? "—" : count.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-400">
                      {pct === null ? "—" : `${pct.toFixed(1)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Attribution by source */}
      <section className="flex flex-col gap-3">
        <SectionLabel>Signups by utm_source · last 30 days</SectionLabel>
        {bySource.length === 0 ? (
          <EmptyRow>No signups in the window.</EmptyRow>
        ) : (
          <SourceTable rows={bySource} />
        )}
      </section>

      {/* Attribution by campaign */}
      <section className="flex flex-col gap-3">
        <SectionLabel>Signups by utm_campaign · last 30 days</SectionLabel>
        {byCampaign.length === 0 ? (
          <EmptyRow>No attributed campaigns in the window.</EmptyRow>
        ) : (
          <CampaignTable rows={byCampaign} />
        )}
      </section>
    </div>
  );
}

function firstNonZero(values: ReadonlyArray<number | null>): number | null {
  for (const v of values) {
    if (v !== null && v > 0) return v;
  }
  return null;
}

function Kpi({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "ok" | "warning" | "muted";
}) {
  const valueClass =
    tone === "ok"
      ? "text-emerald-300"
      : tone === "warning"
        ? "text-amber-300"
        : tone === "muted"
          ? "text-zinc-400"
          : "text-white";
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="text-xs tracking-wider text-zinc-500 uppercase">{label}</div>
      <div className={`font-display mt-1.5 text-2xl font-semibold ${valueClass}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-medium tracking-wider text-zinc-500 uppercase">{children}</div>
  );
}

function SourceTable({ rows }: { rows: ReadonlyArray<{ source: string; count: number }> }) {
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-900/70 text-xs tracking-wider text-zinc-500 uppercase">
          <tr>
            <th className="px-4 py-3 font-medium">utm_source</th>
            <th className="px-4 py-3 text-right font-medium">Signups</th>
            <th className="px-4 py-3 text-right font-medium">Share</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {rows.map((r) => {
            const share = total > 0 ? (r.count / total) * 100 : 0;
            return (
              <tr key={r.source} className="hover:bg-zinc-900/30">
                <td className="px-4 py-3 font-mono text-zinc-200">{r.source}</td>
                <td className="px-4 py-3 text-right font-mono text-zinc-100">
                  {r.count.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-right font-mono text-zinc-400">
                  {share.toFixed(1)}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CampaignTable({ rows }: { rows: ReadonlyArray<{ campaign: string; count: number }> }) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-900/70 text-xs tracking-wider text-zinc-500 uppercase">
          <tr>
            <th className="px-4 py-3 font-medium">utm_campaign</th>
            <th className="px-4 py-3 text-right font-medium">Signups</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {rows.map((r) => (
            <tr key={r.campaign} className="hover:bg-zinc-900/30">
              <td className="px-4 py-3 font-mono text-zinc-200">{r.campaign}</td>
              <td className="px-4 py-3 text-right font-mono text-zinc-100">
                {r.count.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-6 text-center text-sm text-zinc-500">
      {children}
    </div>
  );
}
