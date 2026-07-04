import Link from "next/link";
import { MemberRole, Plan } from "@prisma/client";
import { PLAN_DISPLAY, PLAN_ORDER, planLimitsFor, priceFor } from "@/lib/plans";
import { asSupportedCurrency, DEFAULT_CURRENCY, formatPlanPrice } from "@/lib/currencies";
import { planCapacity } from "@/server/billing/limits";
import {
  costByClient,
  getAgencyUsageTrend,
  type ClientCostRollupRow,
  type UsageTrendBucket,
} from "@/server/db/client-cost";
import { isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";
import { BillingActions } from "@/components/settings/billing-actions";

// Module-level helper — extracted so `Date.now()` isn't called inline
// during render (react-hooks/purity).
function daysUntil(target: Date): number {
  const ms = target.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export default async function BillingPage() {
  const tenant = await resolveTenantContext();

  // Pull the live agency row when DB-backed; fall through to STUDIO defaults
  // when in sample mode so the screen renders cleanly without auth wired up.
  const agency = isLiveDb()
    ? await prisma.agency
        .findUnique({
          where: { id: tenant.agencyId },
          select: {
            plan: true,
            stripeSubscriptionId: true,
            preferredCurrency: true,
            trialStatus: true,
            trialEndsAt: true,
          },
        })
        .catch(() => null)
    : null;

  const plan: Plan = agency?.plan ?? Plan.STUDIO;
  const hasSubscription = agency?.stripeSubscriptionId != null;
  const currency = asSupportedCurrency(agency?.preferredCurrency) ?? DEFAULT_CURRENCY;
  const trialStatus = agency?.trialStatus ?? "NONE";
  const trialEndsAt = agency?.trialEndsAt ?? null;

  // Capacity + invoices: real numbers when DB live, zero baseline otherwise.
  const live = isLiveDb();
  const [shows, members, episodes, generations, invoices] = live
    ? await Promise.all([
        planCapacity(tenant.agencyId, plan, "shows"),
        planCapacity(tenant.agencyId, plan, "members"),
        planCapacity(tenant.agencyId, plan, "episodes"),
        planCapacity(tenant.agencyId, plan, "generations"),
        prisma.invoice.findMany({
          where: { agencyId: tenant.agencyId },
          orderBy: { createdAt: "desc" },
          take: 12,
        }),
      ])
    : [
        { used: 3, limit: planLimitsFor(plan).shows },
        { used: 1, limit: planLimitsFor(plan).seats },
        { used: 0, limit: planLimitsFor(plan).episodesPerMonth },
        { used: 0, limit: planLimitsFor(plan).generationsPerMonth },
        [],
      ];

  const current = PLAN_DISPLAY[plan];
  const limits = planLimitsFor(plan);

  // Phase 2.13.5 — agency-wide cost-to-serve rollup for the current month.
  // OWNER/ADMIN only; the page is open to all roles but this section's data
  // is financial. We use isAdminOrOwner to gate the section's render.
  const isAdminOrOwner = tenant.role === MemberRole.OWNER || tenant.role === MemberRole.ADMIN;
  const costRollup: ClientCostRollupRow[] =
    live && isAdminOrOwner ? await costByClient(tenant) : [];
  // Phase 3.7 — 30-day trend for the cost + generations sparkline. Same
  // OWNER/ADMIN gate as the cost rollup below it.
  const usageTrend: UsageTrendBucket[] =
    live && isAdminOrOwner ? await getAgencyUsageTrend(tenant, 30) : [];
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date());

  return (
    <>
      {/* Trial status card — only rendered when the agency is in a trial-
          related state so the paid-only view stays uncluttered. `daysLeft`
          is computed via a module-level helper so the JSX stays pure. */}
      {trialStatus !== "NONE" ? (
        <TrialStatusCard
          status={trialStatus}
          trialEndsAt={trialEndsAt}
          plan={plan}
          daysLeftIfActive={trialStatus === "ACTIVE" && trialEndsAt ? daysUntil(trialEndsAt) : 0}
        />
      ) : null}

      {/* Current plan card */}
      <div className="border-border bg-surface shadow-card mb-[18px] rounded-3xl border p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-muted-2 font-sans text-[11.5px] font-semibold tracking-[0.06em] uppercase">
              Current plan
            </div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="font-display text-ink text-[24px] font-semibold">
                {current.name}
              </span>
              <span className="text-muted font-sans text-[13.5px]">
                {formatPlanPrice(priceFor(plan, currency), currency)}/mo
              </span>
            </div>
            <p className="text-muted mt-1 text-[13px]">{current.tagline}</p>
          </div>
          <BillingActions
            currentPlan={plan}
            hasSubscription={hasSubscription}
            currency={currency}
          />
        </div>
      </div>

      {/* Usage meters */}
      <div className="mb-[18px] grid grid-cols-1 gap-[18px] md:grid-cols-2">
        <UsageMeter label="Shows" used={shows.used} limit={shows.limit} />
        <UsageMeter label="Seats" used={members.used} limit={members.limit} />
        <UsageMeter label="Episodes this month" used={episodes.used} limit={episodes.limit} />
        <UsageMeter
          label="Generations this month"
          used={generations.used}
          limit={generations.limit}
        />
      </div>

      {/* Plan ladder */}
      <div className="border-border bg-surface shadow-card mb-[18px] rounded-3xl border p-5">
        <div className="mb-[14px] flex items-baseline justify-between">
          <div className="font-display text-ink text-[15px] font-semibold">Plans</div>
          <div className="text-muted-2 text-[12.5px]">
            Monthly cost cap: ${(limits.monthlyCostCapCents / 100).toFixed(0)} of AI spend per month
          </div>
        </div>

        <div className="grid grid-cols-1 gap-[14px] md:grid-cols-3">
          {PLAN_ORDER.map((p) => {
            const d = PLAN_DISPLAY[p];
            const active = p === plan;
            return (
              <div
                key={p}
                className="flex flex-col rounded-2xl p-4"
                style={{
                  border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border)"}`,
                  background: active ? "var(--color-accent-soft)" : "var(--color-surface)",
                }}
              >
                <div className="flex items-baseline justify-between">
                  <div className="font-display text-ink text-[16px] font-semibold">{d.name}</div>
                  <div className="text-muted font-sans text-[13px]">
                    {formatPlanPrice(priceFor(p, currency), currency)}/mo
                  </div>
                </div>
                <p className="text-muted mt-1 text-[12.5px]">{d.tagline}</p>
                <ul className="text-ink mt-[14px] flex flex-1 flex-col gap-[6px] text-[12.5px]">
                  {d.highlights.map((h) => (
                    <li key={h} className="flex items-center gap-[7px]">
                      <span className="bg-accent h-[5px] w-[5px] rounded-full" />
                      {h}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* 30-day trend (3.7) — OWNER/ADMIN only. Two inline SVG rows:
          top row is cost/day, bottom row is generation count/day.
          Zero-filled by getAgencyUsageTrend so empty days render as
          flat baselines instead of gaps. */}
      {isAdminOrOwner && (
        <div className="border-border bg-surface shadow-card mb-[18px] rounded-3xl border p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <div className="font-display text-ink text-[15px] font-semibold">Last 30 days</div>
              <div className="text-muted-2 mt-[3px] text-[12.5px]">
                Daily AI spend + generations across every client. Empty days flatten to zero — the
                trendline tells you when demand actually ramped, not just when it existed.
              </div>
            </div>
          </div>
          <UsageTrendGraph buckets={usageTrend} />
        </div>
      )}

      {/* Cost-to-serve rollup (2.13.5) — OWNER/ADMIN only. */}
      {isAdminOrOwner && (
        <div className="border-border bg-surface shadow-card mb-[18px] rounded-3xl border p-5">
          <div className="mb-[6px] flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <div className="font-display text-ink text-[15px] font-semibold">
                Cost-to-serve by client
              </div>
              <div className="text-muted-2 mt-[3px] text-[12.5px]">
                {monthLabel} — what each client cost vs. what they pay. Negative margins surface
                under-priced clients early.
              </div>
            </div>
          </div>
          <ClientCostRollupTable rows={costRollup} />
        </div>
      )}

      {/* Invoices */}
      <div className="border-border bg-surface shadow-card rounded-3xl border px-5 pt-5 pb-2">
        <div className="font-display text-ink mb-[6px] text-[15px] font-semibold">Invoices</div>
        <div className="text-muted-2 mb-[10px] text-[12.5px]">
          Last {invoices.length || "—"} invoices synced from Stripe
        </div>
        {invoices.length === 0 ? (
          <div className="text-muted-2 py-8 text-center text-[12.5px]">
            No invoices yet. Start a subscription above to see billing history here.
          </div>
        ) : (
          <div>
            {invoices.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center gap-3 border-t border-[#F0F3F8] px-1 py-[13px]"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-ink font-sans text-[13px] font-medium">
                    ${(inv.amountCents / 100).toFixed(2)} {inv.currency.toUpperCase()}
                  </div>
                  <div className="text-muted-2 text-[11.5px]">
                    {new Intl.DateTimeFormat("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    }).format(inv.createdAt)}
                  </div>
                </div>
                <span className="rounded-pill bg-canvas text-muted px-[9px] py-[3px] font-sans text-[11px] font-semibold uppercase">
                  {inv.status}
                </span>
                {inv.hostedInvoiceUrl && (
                  <Link
                    href={inv.hostedInvoiceUrl}
                    className="text-accent font-sans text-[12.5px] font-medium"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ClientCostRollupTable({ rows }: { rows: ClientCostRollupRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="text-muted-2 py-8 text-center text-[12.5px]">
        No clients yet — add a client to start seeing cost-to-serve.
      </div>
    );
  }

  // Sort: clients with negative margin first (the ones we want to surface),
  // then no-margin (no billing profile) by name, then positive margin
  // descending. Keeps the actionable rows on top.
  const sorted = [...rows].sort((a, b) => {
    const am = a.marginCents;
    const bm = b.marginCents;
    if (am == null && bm == null) return a.name.localeCompare(b.name);
    if (am == null) return 1;
    if (bm == null) return -1;
    return am - bm;
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[12.5px]">
        <thead>
          <tr className="border-border text-muted-2 border-b">
            <th className="py-2 pr-3 font-medium">Client</th>
            <th className="py-2 pr-3 text-right font-medium">Cost-to-serve</th>
            <th className="py-2 pr-3 text-right font-medium">Revenue</th>
            <th className="py-2 pr-3 text-right font-medium">Margin</th>
            <th className="py-2 pr-3 text-right font-medium">Episodes</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <ClientCostRow key={r.clientId} row={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClientCostRow({ row }: { row: ClientCostRollupRow }) {
  const negative = row.marginCents != null && row.marginCents < 0;
  const noProfile = row.revenueCents == null;
  const marginColor = noProfile ? "#8B95A6" : negative ? "#A06D12" : "#1E7A47";

  return (
    <tr className="border-border-subtle border-b">
      <td className="py-[10px] pr-3">
        <Link
          href={`/clients/${row.clientId}/billing`}
          className="text-ink hover:text-accent font-sans font-medium"
        >
          {row.name}
        </Link>
      </td>
      <td className="py-[10px] pr-3 text-right font-sans">{formatUsd(row.costCents)}</td>
      <td className="py-[10px] pr-3 text-right font-sans">
        {row.revenueCents == null ? (
          <span className="text-muted-2">—</span>
        ) : (
          formatUsd(row.revenueCents)
        )}
      </td>
      <td
        className="py-[10px] pr-3 text-right font-sans font-semibold"
        style={{ color: marginColor }}
      >
        {row.marginCents == null
          ? "—"
          : (negative ? "−" : "") + formatUsd(Math.abs(row.marginCents))}
      </td>
      <td className="text-muted py-[10px] pr-3 text-right font-sans">{row.episodeCountInWindow}</td>
    </tr>
  );
}

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function UsageTrendGraph({ buckets }: { buckets: UsageTrendBucket[] }) {
  if (buckets.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#E6EBF3] bg-[#FBFCFE] p-8 text-center text-[12.5px] text-zinc-500">
        No AI spend yet — generate an episode to start populating this chart.
      </div>
    );
  }

  const totalCost = buckets.reduce((acc, b) => acc + b.costCents, 0);
  const totalGens = buckets.reduce((acc, b) => acc + b.generations, 0);
  const maxCost = Math.max(1, ...buckets.map((b) => b.costCents));
  const maxGens = Math.max(1, ...buckets.map((b) => b.generations));

  const width = 720;
  const height = 96;
  const padX = 8;
  const barAreaWidth = width - padX * 2;
  const slotWidth = barAreaWidth / buckets.length;
  const barWidth = Math.max(2, Math.min(slotWidth * 0.72, 20));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <TrendStat label="Cost, 30 days" value={formatUsd(totalCost)} />
        <TrendStat label="Generations" value={totalGens.toLocaleString()} />
        <TrendStat
          label="Avg cost / day"
          value={formatUsd(Math.round(totalCost / buckets.length))}
        />
        <TrendStat
          label="Avg cost / generation"
          value={totalGens > 0 ? formatUsd(Math.round(totalCost / totalGens)) : "—"}
        />
      </div>

      <TrendBars
        buckets={buckets}
        max={maxCost}
        valueFor={(b) => b.costCents}
        width={width}
        height={height}
        padX={padX}
        slotWidth={slotWidth}
        barWidth={barWidth}
        color="#3A5BA0"
        label="Cost / day"
      />
      <TrendBars
        buckets={buckets}
        max={maxGens}
        valueFor={(b) => b.generations}
        width={width}
        height={height}
        padX={padX}
        slotWidth={slotWidth}
        barWidth={barWidth}
        color="#2E9E5B"
        label="Generations / day"
      />
    </div>
  );
}

function TrendStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#E6EBF3] bg-[#FBFCFE] p-3">
      <div className="font-mono text-[10.5px] tracking-[0.05em] text-zinc-500 uppercase">
        {label}
      </div>
      <div className="text-ink mt-1 font-sans text-[15px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function TrendBars({
  buckets,
  max,
  valueFor,
  width,
  height,
  padX,
  slotWidth,
  barWidth,
  color,
  label,
}: {
  buckets: UsageTrendBucket[];
  max: number;
  valueFor: (b: UsageTrendBucket) => number;
  width: number;
  height: number;
  padX: number;
  slotWidth: number;
  barWidth: number;
  color: string;
  label: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-muted-2 font-mono text-[10.5px] tracking-[0.05em] uppercase">
          {label}
        </span>
        <span className="text-muted-2 font-mono text-[10.5px]">
          {buckets[0]!.dateIso} → {buckets[buckets.length - 1]!.dateIso}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[80px] w-full"
        role="img"
        aria-label={label}
      >
        {/* Baseline */}
        <line
          x1={padX}
          x2={width - padX}
          y1={height - 4}
          y2={height - 4}
          stroke="#E6EBF3"
          strokeWidth={1}
        />
        {buckets.map((b, i) => {
          const value = valueFor(b);
          const h = value === 0 ? 2 : Math.round((value / max) * (height - 12));
          const cx = padX + slotWidth * i + slotWidth / 2;
          return (
            <rect
              key={b.dateIso}
              x={cx - barWidth / 2}
              y={height - 4 - h}
              width={barWidth}
              height={h}
              rx={2}
              fill={color}
              opacity={value === 0 ? 0.15 : 0.85}
            >
              <title>{`${b.dateIso}: ${value === 0 ? "no activity" : label.replace(" / day", "")} ${label.startsWith("Cost") ? formatUsd(value) : value}`}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

function TrialStatusCard({
  status,
  trialEndsAt,
  plan,
  daysLeftIfActive,
}: {
  status: "ACTIVE" | "CONVERTED" | "EXPIRED" | "CANCELED";
  trialEndsAt: Date | null;
  plan: Plan;
  /** Precomputed by the parent so this component stays pure. */
  daysLeftIfActive: number;
}) {
  const dateLabel = trialEndsAt
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(trialEndsAt)
    : "—";

  const [pillLabel, pillBg, pillFg, headline, body]: [string, string, string, string, string] =
    (() => {
      switch (status) {
        case "ACTIVE": {
          const daysLeft = daysLeftIfActive;
          const left =
            daysLeft === 0 ? "Ends today" : daysLeft === 1 ? "1 day left" : `${daysLeft} days left`;
          return [
            left,
            "#E6F1EA",
            "#1E7A47",
            `Trial — ${plan}`,
            `Your first plan charge lands ${dateLabel} unless you cancel. Your $1 activation is not refunded, but you keep everything you've generated either way.`,
          ];
        }
        case "CONVERTED":
          return [
            "Converted",
            "#E6F1EA",
            "#1E7A47",
            "Trial converted",
            `You're a paying customer since ${dateLabel}. Thanks for sticking with us.`,
          ];
        case "EXPIRED":
          return [
            "Expired",
            "#FBE7E4",
            "#A02B1C",
            "Trial ended without a full charge",
            `Your trial ended ${dateLabel} and the first plan invoice couldn't be charged. You're on SOLO now — restart any time by starting a subscription.`,
          ];
        case "CANCELED":
          return [
            "Canceled",
            "#FDF1DC",
            "#7A5B1E",
            "Trial canceled",
            `You canceled on ${dateLabel} — no plan charge (the $1 activation is not refunded). You're on SOLO; upgrade any time.`,
          ];
      }
    })();

  return (
    <div className="border-border bg-surface shadow-card mb-[18px] rounded-3xl border p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-muted-2 font-sans text-[11.5px] font-semibold tracking-[0.06em] uppercase">
            Trial
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-display text-ink text-[19px] font-semibold">{headline}</span>
            <span
              className="rounded-pill px-[9px] py-[3px] font-sans text-[11px] font-semibold tracking-[0.04em] uppercase"
              style={{ background: pillBg, color: pillFg }}
            >
              {pillLabel}
            </span>
          </div>
          <p className="text-muted mt-1 text-[13px]">{body}</p>
        </div>
      </div>
    </div>
  );
}

function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const overWarning = pct >= 80;
  return (
    <div className="border-border bg-surface shadow-card rounded-2xl border p-[18px]">
      <div className="mb-[10px] flex items-baseline justify-between">
        <div className="text-muted font-sans text-[12.5px] font-semibold">{label}</div>
        <div className="text-ink font-sans text-[13.5px] font-semibold">
          {used} <span className="text-muted-2">/ {limit}</span>
        </div>
      </div>
      <div className="h-[6px] overflow-hidden rounded-md bg-[#EEF1F6]">
        <div
          className="h-full rounded-md transition-[width]"
          style={{
            width: `${pct}%`,
            background: overWarning ? "#C9952B" : "var(--color-accent)",
          }}
        />
      </div>
      {overWarning && (
        <div className="mt-2 text-[11.5px] text-[#A06D12]">
          {pct >= 100 ? "Limit reached — upgrade to continue." : "Near your limit."}
        </div>
      )}
    </div>
  );
}
