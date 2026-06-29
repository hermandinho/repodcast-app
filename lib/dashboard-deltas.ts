/**
 * Pure formatters for the month-over-month delta pills on the dashboard
 * KPIs. Live in `lib/` (not `server/`) because they're stateless string
 * formatters — keeps them trivially testable without a Prisma mock.
 */

/**
 * Format an absolute month-over-month delta — appropriate for low-cardinality
 * metrics like episode count where the absolute change is more informative
 * than the percentage. Returns "" when both periods are zero (no signal yet).
 *
 * Examples:
 *   formatAbsDelta(9, 7, "May") → "▲ 2 vs. May"
 *   formatAbsDelta(5, 7, "May") → "▼ 2 vs. May"
 *   formatAbsDelta(7, 7, "May") → "± vs. May"
 *   formatAbsDelta(0, 0, "May") → ""
 */
export function formatAbsDelta(current: number, prior: number, priorLabel: string): string {
  if (prior === 0 && current === 0) return "";
  const diff = current - prior;
  if (diff === 0) return `± vs. ${priorLabel}`;
  const arrow = diff > 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(diff)} vs. ${priorLabel}`;
}

/**
 * Format a percent-change month-over-month delta — appropriate for
 * higher-volume metrics like total outputs generated. Returns "▲ new" when
 * prior was zero and current is positive (percent change is undefined but
 * the lift is real and worth surfacing).
 *
 * Examples:
 *   formatPctDelta(63, 50) → "▲ 26%"
 *   formatPctDelta(40, 50) → "▼ 20%"
 *   formatPctDelta(50, 50) → "± vs. prev"
 *   formatPctDelta(10, 0)  → "▲ new"
 *   formatPctDelta(0, 0)   → ""
 */
export function formatPctDelta(current: number, prior: number): string {
  if (prior === 0 && current === 0) return "";
  if (prior === 0) return "▲ new";
  const pct = Math.round(((current - prior) / prior) * 100);
  if (pct === 0) return "± vs. prev";
  const arrow = pct > 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(pct)}%`;
}
