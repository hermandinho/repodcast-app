import type { ClientCostResult } from "@/server/db/client-cost";

/**
 * Phase 2.13.5 — per-client cost-to-serve card on the Deliverables &
 * Billing tab. Shows this calendar month's cost from `UsageLog`, the
 * revenue derived from the billing profile (retainer or rate × episodes),
 * and the margin pill (amber when negative — surfaces under-priced clients
 * early).
 *
 * Null props are tolerated:
 *  - `cost` null  → sample-data mode; render in a "no data" branch.
 *  - both retainer + rate null → no billing profile yet; margin shows "—"
 *    with a prompt to fill in the form above.
 */
export function CostToServeCard({
  cost,
  retainerCents,
  ratePerEpisodeCents,
  currency,
}: {
  cost: ClientCostResult | null;
  retainerCents: number | null;
  ratePerEpisodeCents: number | null;
  currency: string;
}) {
  // Header copy
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date());

  if (!cost) {
    return (
      <section className="border-border bg-surface rounded-3xl border p-5">
        <Header monthLabel={monthLabel} />
        <p className="border-border bg-canvas text-muted-2 mt-3 rounded-xl border border-dashed px-4 py-6 text-center text-[12.5px]">
          Connect a database to see this month&apos;s cost-to-serve.
        </p>
      </section>
    );
  }

  const fmt = (cents: number) => formatCurrency(cents, currency);

  let revenueCents: number | null = null;
  let revenueLabel = "—";
  if (retainerCents != null && retainerCents > 0) {
    revenueCents = retainerCents;
    revenueLabel = fmt(retainerCents);
  } else if (
    ratePerEpisodeCents != null &&
    ratePerEpisodeCents > 0 &&
    cost.episodeCountInWindow > 0
  ) {
    revenueCents = ratePerEpisodeCents * cost.episodeCountInWindow;
    revenueLabel = `${fmt(revenueCents)} (${cost.episodeCountInWindow} × ${fmt(ratePerEpisodeCents)})`;
  }

  const marginCents = revenueCents == null ? null : revenueCents - cost.costCents;
  const negative = marginCents != null && marginCents < 0;
  const noProfile = revenueCents == null;

  return (
    <section className="border-border bg-surface rounded-3xl border p-5">
      <Header monthLabel={monthLabel} />

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Cost-to-serve"
          value={fmt(cost.costCents)}
          hint={`${cost.episodeCountInWindow} episode${cost.episodeCountInWindow === 1 ? "" : "s"} this month`}
        />
        <Stat
          label="Revenue"
          value={revenueLabel}
          hint={revenueHint(retainerCents, ratePerEpisodeCents)}
        />
        <Stat
          label="Margin"
          value={marginCents == null ? "—" : (negative ? "−" : "") + fmt(Math.abs(marginCents))}
          valueColor={marginCents == null ? undefined : negative ? "#A06D12" : "#1E7A47"}
          hint={
            noProfile
              ? "Add a retainer or rate above to compute margin."
              : negative
                ? "Costs exceed revenue this month."
                : "Revenue minus cost-to-serve."
          }
        />
      </div>
    </section>
  );
}

function Header({ monthLabel }: { monthLabel: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <div className="font-display text-ink text-[15px] font-semibold">Cost-to-serve</div>
        <div className="text-muted-2 mt-[3px] text-[12.5px]">
          {monthLabel} — usage so far this period.
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  valueColor,
}: {
  label: string;
  value: string;
  hint: string;
  valueColor?: string;
}) {
  return (
    <div className="border-border-subtle bg-surface-2 rounded-2xl border p-4">
      <div className="text-muted-2 font-sans text-[11.5px] font-medium tracking-[0.05em] uppercase">
        {label}
      </div>
      <div
        className="font-display text-ink mt-2 text-[22px] font-bold tracking-[-0.3px]"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </div>
      <div className="text-muted-2 mt-1 text-[11.5px] leading-[1.45]">{hint}</div>
    </div>
  );
}

function revenueHint(retainerCents: number | null, ratePerEpisodeCents: number | null): string {
  if (retainerCents != null && retainerCents > 0) return "Monthly retainer.";
  if (ratePerEpisodeCents != null && ratePerEpisodeCents > 0) {
    return "Per-episode rate × episodes this month.";
  }
  return "Set a retainer or rate in the form above.";
}

/**
 * Cheap money formatter — `Intl.NumberFormat` does the heavy lifting; the
 * currency code comes from the billing profile (defaults to USD).
 */
function formatCurrency(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    // `currency` was hand-entered — fall back to plain number + code.
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
