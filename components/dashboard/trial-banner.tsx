import Link from "next/link";
import type { Plan } from "@prisma/client";

/**
 * In-app banner rendered above the main scroller in the dashboard shell
 * whenever an agency is inside their trial window. Length is `TRIAL_DAYS`
 * in `lib/plans.ts`. Only Solo trials exist today (see MarketingStrategy.md
 * §1), so the trial banner effectively renders for the Solo tier.
 *
 * Revamp visual system: dark ink `#0a1e3c` base with a mono pill on the
 * left carrying the countdown and muted copy explaining the day-8 charge.
 * The urgent state (≤3 days) swaps the pill tint to a red variant but
 * keeps the dark base — a red-flood variant reads panicky in the shell.
 *
 * Pure component — `daysLeft` and the formatted end-date label are
 * computed by the async server-component parent (see the dashboard layout)
 * so this file stays free of `Date.now()` and passes `react-hooks/purity`.
 */
export function TrialBanner({
  plan,
  daysLeft,
  endsAtLabel,
}: {
  plan: Plan;
  daysLeft: number;
  endsAtLabel: string;
}) {
  const urgent = daysLeft <= 3;
  // Countdown pill — accent-tint in the calm state, red-tint in the urgent
  // state. We stay on a dark base regardless so the banner reads as a
  // persistent status ribbon and not a full-red alert.
  const pillBg = urgent ? "rgba(255,130,116,0.22)" : "rgba(126,166,255,0.20)";
  const pillColor = urgent ? "#FBB4A7" : "#7EA6FF";
  const linkColor = urgent ? "#FBB4A7" : "#7EA6FF";

  const label =
    daysLeft === 0
      ? `TRIAL · ENDS TODAY`
      : daysLeft === 1
        ? `TRIAL · 1 DAY LEFT`
        : `TRIAL · ${daysLeft} DAYS LEFT`;

  return (
    <div
      className="flex w-full items-center justify-between"
      role="status"
      aria-live="polite"
      style={{
        background: "#0a1e3c",
        color: "#ffffff",
        padding: "10px 32px",
        fontFamily: "var(--font-revamp-sans)",
        fontSize: 13.5,
      }}
    >
      <div className="flex min-w-0 items-center" style={{ gap: 10 }}>
        <span
          style={{
            background: pillBg,
            color: pillColor,
            fontFamily: "var(--font-revamp-mono)",
            fontSize: 11,
            padding: "3px 9px",
            borderRadius: 99,
            letterSpacing: "0.06em",
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {label}
        </span>
        <span className="min-w-0 truncate" style={{ color: "#a9b8d4" }}>
          {plan} plan — card charged {endsAtLabel} unless you cancel.
        </span>
      </div>
      <Link
        href="/settings/billing"
        className="ml-3 flex-shrink-0 no-underline"
        style={{ fontSize: 12.5, fontWeight: 600, color: linkColor }}
      >
        Manage billing →
      </Link>
    </div>
  );
}
