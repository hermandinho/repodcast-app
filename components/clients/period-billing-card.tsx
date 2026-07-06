/**
 * "This period" billing summary — replaces the old `CostToServeCard`
 * on the client billing tab. Focuses on what the client owes the
 * agency, not on internal cost-to-serve (that data is `/root`-only now).
 *
 * Data comes straight from the billing profile + a count of episodes
 * produced this calendar month, so the card renders even when no
 * statement has been generated yet.
 */

export function PeriodBillingCard({
  retainerCents,
  ratePerEpisodeCents,
  episodesThisMonth,
  currency,
}: {
  retainerCents: number | null;
  ratePerEpisodeCents: number | null;
  episodesThisMonth: number | null;
  currency: string;
}) {
  const monthLabel = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date());

  const fmt = (cents: number) => formatCurrency(cents, currency);

  const retainer = retainerCents != null && retainerCents > 0 ? retainerCents : 0;
  const perEpisode =
    ratePerEpisodeCents != null && ratePerEpisodeCents > 0 && episodesThisMonth != null
      ? ratePerEpisodeCents * episodesThisMonth
      : 0;
  const total = retainer + perEpisode;
  const noProfile = retainer === 0 && perEpisode === 0;

  return (
    <section className="border-border bg-surface rounded-3xl border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-display text-ink text-[15px] font-semibold">This period</div>
          <div className="text-muted-2 mt-[3px] text-[12.5px]">
            {monthLabel} — what the client owes so far this month.
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Stat
          label="Retainer"
          value={retainer > 0 ? fmt(retainer) : "—"}
          hint={retainer > 0 ? "Fixed monthly retainer." : "No retainer configured."}
        />
        <Stat
          label="Per-episode"
          value={perEpisode > 0 ? fmt(perEpisode) : "—"}
          hint={
            ratePerEpisodeCents && ratePerEpisodeCents > 0
              ? `${episodesThisMonth ?? 0} episode${(episodesThisMonth ?? 0) === 1 ? "" : "s"} × ${fmt(ratePerEpisodeCents)}`
              : "No per-episode rate configured."
          }
        />
        <Stat
          label="Total"
          value={noProfile ? "—" : fmt(total)}
          hint={
            noProfile
              ? "Set a retainer or rate in the form above."
              : "Retainer + per-episode line total."
          }
          highlight
        />
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  highlight = false,
}: {
  label: string;
  value: string;
  hint: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        highlight
          ? "border-accent-border bg-accent-soft rounded-2xl border p-4"
          : "border-border-subtle bg-surface-2 rounded-2xl border p-4"
      }
    >
      <div className="text-muted-2 font-sans text-[11.5px] font-medium tracking-[0.05em] uppercase">
        {label}
      </div>
      <div className="font-display text-ink mt-2 text-[22px] font-bold tracking-[-0.3px] tabular-nums">
        {value}
      </div>
      <div className="text-muted-2 mt-1 text-[11.5px] leading-[1.45]">{hint}</div>
    </div>
  );
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
