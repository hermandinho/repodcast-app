import Link from "next/link";
import type { Plan } from "@prisma/client";
import type { LimitedResource } from "@/server/billing/limits";
import { planDisplayFor } from "@/lib/plans";

export type PlanLimitCapacity = {
  used: number;
  limit: number;
  plan: Plan;
  resource: LimitedResource;
};

const RESOURCE_LABEL: Record<LimitedResource, { noun: string; window: string }> = {
  shows: { noun: "shows", window: "" },
  members: { noun: "seats", window: "" },
  episodes: { noun: "episodes", window: " this month" },
  generations: { noun: "generations", window: " this month" },
};

/**
 * Soft upgrade prompt rendered on create flows when an agency is approaching
 * or has hit a plan cap. Three states:
 *  - < 80% usage → renders nothing (no nag below the warning band)
 *  - 80–99%      → amber notice + "View plans" CTA
 *  - >= 100%     → red blocking notice + "Upgrade plan" CTA
 *
 * Sample-data mode passes `null` so the banner stays invisible during the
 * design-time preview.
 */
export function PlanLimitBanner({
  capacity,
  className,
}: {
  capacity: PlanLimitCapacity | null;
  className?: string;
}) {
  if (!capacity || capacity.limit <= 0) return null;
  const ratio = capacity.used / capacity.limit;
  if (ratio < 0.8) return null;

  const atCap = capacity.used >= capacity.limit;
  const meta = RESOURCE_LABEL[capacity.resource];
  const planName = planDisplayFor(capacity.plan).name;
  const palette = atCap
    ? { bg: "#FBEDEC", border: "#F0CCC9", text: "#8A2A1F", accent: "#C0392B" }
    : { bg: "#FBF1DE", border: "#E6D9B8", text: "#7A570C", accent: "#A06D12" };

  const headline = atCap
    ? `You've hit the ${planName} cap of ${capacity.limit} ${meta.noun}${meta.window}.`
    : `Heads up — ${capacity.used} of ${capacity.limit} ${meta.noun}${meta.window} used on the ${planName} plan.`;

  const subline = atCap
    ? "Upgrade to keep creating, or wait for the next billing window."
    : "Upgrade now to avoid hitting the cap mid-flow.";

  return (
    <div
      className={[
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-[10px]",
        className ?? "",
      ].join(" ")}
      style={{ background: palette.bg, borderColor: palette.border }}
    >
      <div className="flex items-start gap-[10px]">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke={palette.accent}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mt-[1px] flex-shrink-0"
          aria-hidden
        >
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 4.5v4" />
          <path d="M8 11h.01" />
        </svg>
        <div className="min-w-0">
          <div className="font-sans text-[12.5px] font-semibold" style={{ color: palette.text }}>
            {headline}
          </div>
          <div
            className="mt-[2px] font-sans text-[12px] leading-[1.4]"
            style={{ color: palette.text, opacity: 0.85 }}
          >
            {subline}
          </div>
        </div>
      </div>
      <Link
        href="/settings/billing"
        className="rounded-md bg-white px-[12px] py-[7px] font-sans text-[12.5px] font-semibold transition-[filter] hover:brightness-95"
        style={{
          border: `1px solid ${palette.border}`,
          color: palette.accent,
        }}
      >
        {atCap ? "Upgrade plan" : "View plans"}
      </Link>
    </div>
  );
}
