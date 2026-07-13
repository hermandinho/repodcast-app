import Link from "next/link";
import type { Plan } from "@prisma/client";
import type { RegenKind } from "@/server/db/agency-regen-counters";
import { PLAN_DISPLAY, PLAN_LIMITS, PLAN_ORDER, REGEN_UNLIMITED } from "@/lib/plans";

/**
 * PricingV2 §8 PR 3 — per-tab regeneration budget meter.
 *
 * Renders "X of Y regenerations used this month" above the primary action
 * on the Clips / Artwork / Audiogram tabs. Three visual states:
 *
 *   - Unlimited (Network): compact "Unlimited this month" pill; the
 *     internal `monthlyCostCapCents` ceiling is deliberately not surfaced
 *     — buyers only see the marketing promise.
 *   - Under 80%: neutral gray bar with counter.
 *   - 80–99%: amber bar + "Nearing cap" note.
 *   - >= 100%: red bar + inline upgrade CTA naming the next tier
 *     (`Upgrade to Studio` etc). The action itself is disabled by the
 *     server-side `assertAndConsumeRegen` gate; the meter mirrors that
 *     state so the user isn't left guessing.
 *
 * `used` and `limit` come from `loadRegenQuotasForUI` on the server. In
 * sample-data mode callers pass `null` and the meter renders nothing so
 * the design-time preview stays uncluttered.
 */
export type RegenQuota = {
  used: number;
  limit: number;
};

const KIND_LABEL: Record<RegenKind, { singular: string; plural: string }> = {
  clip: { singular: "clip regeneration", plural: "clip regenerations" },
  artwork: { singular: "artwork regeneration", plural: "artwork regenerations" },
  audiogram: { singular: "audiogram regeneration", plural: "audiogram regenerations" },
};

export function RegenQuotaMeter({
  kind,
  plan,
  quota,
  className,
}: {
  kind: RegenKind;
  plan: Plan;
  quota: RegenQuota | null;
  className?: string;
}) {
  if (!quota) return null;
  const { used, limit } = quota;
  const label = KIND_LABEL[kind];
  const wrapperClass = [
    "border-border bg-surface flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3",
    className ?? "",
  ]
    .join(" ")
    .trim();

  if (limit >= REGEN_UNLIMITED) {
    return (
      <div className={wrapperClass}>
        <div className="flex items-center gap-2">
          <UnlimitedGlyph />
          <div>
            <div className="text-ink text-[13px] font-semibold">
              Unlimited {label.plural} this month
            </div>
            <div className="text-muted-2 mt-0.5 text-[12px]">
              Included at every tier — no counter, no cap on the {planNameFor(plan)} plan.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const ratio = limit > 0 ? Math.min(used / limit, 1) : 0;
  const atCap = used >= limit;
  const warning = !atCap && ratio >= 0.8;

  const colors = atCap
    ? { fill: "#C0392B", track: "#F5D8D3", note: "#8A2A1F" }
    : warning
      ? { fill: "#A06D12", track: "#F1E4C4", note: "#7A570C" }
      : { fill: "#3A5BA0", track: "#E4E9F1", note: "#41506B" };

  const nextTier = nextPlanNameAfter(plan);

  return (
    <div className={wrapperClass}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-ink text-[13px] font-semibold">
            {used} of {limit} {label.plural} used this month
          </div>
          <div className="text-muted-2 text-[11.5px] font-medium tracking-[0.06em] uppercase">
            {atCap ? "Cap reached" : warning ? "Nearing cap" : "Included"}
          </div>
        </div>
        <div
          className="mt-2 h-[6px] w-full overflow-hidden rounded-full"
          style={{ background: colors.track }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          aria-label={`${label.plural} used this month`}
        >
          <div
            className="h-full rounded-full transition-[width]"
            style={{
              width: `${Math.max(ratio * 100, atCap ? 100 : 4)}%`,
              background: colors.fill,
            }}
          />
        </div>
        <div className="text-muted-2 mt-2 text-[12px] leading-[1.5]">
          {atCap ? (
            <span style={{ color: colors.note }}>
              Every {label.singular} button pauses until the next billing cycle. Existing renders
              stay downloadable.
            </span>
          ) : (
            <>
              First render is always free — only re-runs (retry, trim + re-render, regenerate all)
              count.
            </>
          )}
        </div>
      </div>
      {atCap && nextTier ? (
        <Link
          href="/settings/billing"
          className="rounded-md bg-white px-3 py-[7px] font-sans text-[12.5px] font-semibold whitespace-nowrap transition-[filter] hover:brightness-95"
          style={{ border: `1px solid #F0CCC9`, color: "#C0392B" }}
        >
          Upgrade to {nextTier}
        </Link>
      ) : null}
    </div>
  );
}

function planNameFor(plan: Plan): string {
  return PLAN_DISPLAY[plan].name;
}

/**
 * Per-episode clip-count hint. Rendered next to the clip count on the
 * Clips tab so operators see their per-episode ceiling in context and
 * can spot the upgrade path when they hit it. Distinct from the regen
 * meter above — that's a monthly budget, this is a per-episode ceiling.
 *
 * Renders nothing when the operator is on NETWORK (top tier — no
 * upgrade path exists).
 */
export function ClipsPerEpisodeHint({
  plan,
  currentCount,
  className,
}: {
  plan: Plan;
  currentCount: number;
  className?: string;
}) {
  const cap = PLAN_LIMITS[plan].clipsPerEpisode;
  const nextTier = nextPlanNameAfter(plan);
  const atCap = currentCount >= cap;

  if (!nextTier) return null;
  const nextCap = PLAN_LIMITS[nextPlanAfter(plan)!].clipsPerEpisode;
  if (nextCap <= cap) return null;

  return (
    <span
      className={["text-[12px]", className ?? ""].join(" ").trim()}
      style={{ color: atCap ? "#8A2A1F" : "#8A97AD" }}
    >
      {atCap ? (
        <>
          Cap reached —{" "}
          <Link
            href="/settings/billing"
            className="font-semibold hover:underline"
            style={{ color: "#3A5BA0" }}
          >
            upgrade to {nextTier}
          </Link>{" "}
          for {nextCap} clips per episode.
        </>
      ) : (
        <>
          Up to {cap} clips per episode on {planNameFor(plan)} · {nextTier} lifts this to {nextCap}.
        </>
      )}
    </span>
  );
}

function nextPlanAfter(plan: Plan): Plan | null {
  const idx = PLAN_ORDER.indexOf(plan);
  if (idx === -1 || idx === PLAN_ORDER.length - 1) return null;
  return PLAN_ORDER[idx + 1];
}

/** Next tier up the ladder — or null on the top tier. Matches
 *  `nextTierName` in `server/billing/limits.ts`. */
function nextPlanNameAfter(plan: Plan): string | null {
  const idx = PLAN_ORDER.indexOf(plan);
  if (idx === -1 || idx === PLAN_ORDER.length - 1) return null;
  return PLAN_DISPLAY[PLAN_ORDER[idx + 1]].name;
}

function UnlimitedGlyph() {
  return (
    <span
      aria-hidden
      className="grid place-items-center rounded-md"
      style={{
        width: 22,
        height: 22,
        background: "#eef2fb",
        color: "#3A5BA0",
        flexShrink: 0,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M18.5 12a3.5 3.5 0 1 0-4.5-3.354M5.5 12a3.5 3.5 0 1 1 4.5-3.354"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M5.5 12a3.5 3.5 0 1 0 4.5 3.354M18.5 12a3.5 3.5 0 1 1-4.5 3.354"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
