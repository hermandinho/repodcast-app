import Link from "next/link";
import type { Plan } from "@prisma/client";

/**
 * In-app banner rendered above the main scroller in the dashboard shell
 * whenever an agency is inside their trial window (Phase 3.9). Length is
 * `TRIAL_DAYS` in `lib/plans.ts`.
 *
 * Two visual states:
 *   - Days-left ≥ 4: neutral tone.
 *   - Days-left ≤ 3: red / urgent — matches the T-3 email cadence Stripe
 *     drives via `subscription.trial_will_end`.
 *
 * Copy focuses on the "you're already set up, keep going" message; the CTA
 * links to /settings/billing so a user who wants to cancel can. We never
 * show an in-app "cancel" button — Stripe Customer Portal owns that surface.
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
  const bg = urgent ? "bg-red-600" : "bg-[#1A2A4A]";
  const label =
    daysLeft === 0
      ? "Trial ends today"
      : daysLeft === 1
        ? "1 day left in trial"
        : `${daysLeft} days left in trial`;

  return (
    <div
      className={`${bg} flex w-full items-center justify-between gap-4 px-6 py-2 text-[12.5px] font-medium text-white shadow-sm`}
      role="status"
      aria-live="polite"
    >
      <div className="min-w-0 flex-1 truncate">
        <span className="font-semibold">{label}</span> — you&apos;re on{" "}
        <span className="font-semibold">{plan}</span>. Card on file will be charged {endsAtLabel}{" "}
        unless you cancel.
      </div>
      <Link
        href="/settings/billing"
        className="rounded border border-white/40 px-3 py-1 text-[11.5px] font-semibold tracking-wider uppercase hover:bg-white/10"
      >
        Manage billing →
      </Link>
    </div>
  );
}
