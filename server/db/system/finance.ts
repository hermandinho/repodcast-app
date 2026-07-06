import "server-only";

import { type InvoiceStatus, type Plan, type Prisma } from "@prisma/client";
import { z } from "zod";
import { priceFor } from "@/lib/plans";
import { assertSystemRole, SYSTEM_READ_ROLES, type SystemAdminContext } from "@/server/auth/system";
import { prisma } from "@/server/db/client";

/**
 * Phase 3.6.7 — finance dashboard repo helpers.
 *
 * v1 scope (ship-order step 6):
 *   - `getFinanceSummary` — MRR by plan + by currency, signup-cohort table
 *     (12-month lookback), invoice rollups (lifetime paid, MTD paid,
 *     outstanding-open).
 *   - `listInvoicesForRoot` — paginated invoice table with status / agency
 *     search / date-range filters; powers the dashboard's invoice section.
 *   - `streamInvoicesForCsv` — same query without pagination; the CSV route
 *     pipes the result into RFC-4180 output.
 *
 * Out-of-scope (each blocked on schema or webhook surface we don't yet have):
 *   - MoM movement waterfall (no historical plan-change log)
 *   - Full subscription-state retention heatmap (needs sub-state snapshots)
 *   - Disputes / failed-payment surface (needs Stripe events to land in a
 *     queryable table beyond `WebhookDelivery`)
 *   - LTV / CAC (blocked on `SystemConfig` from 3.6.11)
 *
 * MRR convention: "paying" = `Agency.stripeSubscriptionId IS NOT NULL`. Plan
 * prices come from `lib/plans.ts` — the same source-of-truth Stripe uses via
 * `npm run stripe:plans`. Totals normalize to USD cents; the per-currency
 * breakdown preserves the actual billing currency.
 */

// ============================================================
// Summary
// ============================================================

export type FinanceSummary = {
  /** Top-of-page money. Normalized to USD cents. */
  mrr: {
    totalCents: number;
    arrCents: number;
    payingAgencies: number;
    nonPayingAgencies: number;
    /** Sorted by Plan order (SOLO → STUDIO → AGENCY → NETWORK). */
    byPlan: Array<{ plan: Plan; agencies: number; mrrCents: number }>;
    /**
     * Sorted by agency count descending. Each row's `mrrCents` is in the
     * native currency (e.g. EUR cents for EUR rows) — the dashboard renders
     * them with their own symbol. Total MRR above stays USD-normalized.
     */
    byCurrency: Array<{ currency: string; agencies: number; mrrCents: number }>;
  };
  invoices: {
    totalCount: number;
    paidLifetimeCents: number;
    paidMtdCents: number;
    /** Sum of OPEN invoice amounts — money awaiting payment. */
    outstandingCents: number;
  };
  /**
   * Last 12 months of signup cohorts (ascending by month). `currentMrrCents`
   * is what THOSE specific agencies contribute to MRR today — useful for
   * spotting "the December cohort never paid" patterns.
   */
  cohorts: Array<{
    monthIso: string;
    agencies: number;
    payingAgencies: number;
    currentMrrCents: number;
  }>;
};

export async function getFinanceSummary(ctx: SystemAdminContext): Promise<FinanceSummary> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const now = new Date();
  const ms = monthStart(now);
  const cohortFrom = monthStartOffset(now, -11); // 12 inclusive months back

  const [
    payingByPlan,
    payingAgencies,
    allAgenciesByCurrency,
    nonPayingAgencies,
    paidInvoicesAgg,
    paidMtdInvoicesAgg,
    outstandingInvoicesAgg,
    totalInvoiceCount,
    cohortAgencies,
  ] = await Promise.all([
    prisma.agency.groupBy({
      by: ["plan"],
      where: { stripeSubscriptionId: { not: null } },
      _count: { _all: true },
    }),
    prisma.agency.findMany({
      where: { stripeSubscriptionId: { not: null } },
      select: { plan: true, preferredCurrency: true },
    }),
    prisma.agency.groupBy({
      by: ["preferredCurrency"],
      _count: { _all: true },
    }),
    prisma.agency.count({ where: { stripeSubscriptionId: null } }),
    prisma.invoice.aggregate({
      where: { status: "PAID" },
      _sum: { amountCents: true },
    }),
    prisma.invoice.aggregate({
      where: { status: "PAID", createdAt: { gte: ms } },
      _sum: { amountCents: true },
    }),
    prisma.invoice.aggregate({
      where: { status: "OPEN" },
      _sum: { amountCents: true },
    }),
    prisma.invoice.count(),
    prisma.agency.findMany({
      where: { createdAt: { gte: cohortFrom } },
      select: {
        createdAt: true,
        plan: true,
        stripeSubscriptionId: true,
      },
    }),
  ]);

  // MRR rollup --------------------------------------------------------------
  // Total: USD-normalized, summed via `priceFor(plan)` (defaults to USD).
  const totalCents = sumPlanPriceCents(payingByPlan);

  const byPlan = PLAN_ORDER_RANK.map((plan) => {
    const row = payingByPlan.find((p) => p.plan === plan);
    const agencies = row?._count._all ?? 0;
    return {
      plan,
      agencies,
      mrrCents: agencies * priceFor(plan) * 100,
    };
  });

  // Per-currency: each agency's plan price in ITS currency. `priceFor` reads
  // the currency-specific value from `PLAN_PRICES_BY_CURRENCY`; we bucket
  // the paying-agency rows and sum natively.
  const currencyBuckets = new Map<string, { agencies: number; mrrCents: number }>();
  for (const a of payingAgencies) {
    const code = a.preferredCurrency || "USD";
    const cur = currencyBuckets.get(code) ?? { agencies: 0, mrrCents: 0 };
    cur.agencies += 1;
    cur.mrrCents += priceFor(a.plan, isSupportedCurrency(code) ? code : "USD") * 100;
    currencyBuckets.set(code, cur);
  }

  // The byCurrency table also surfaces non-paying buckets so finance can see
  // "we have N USD agencies who haven't subscribed yet." Merge those in.
  for (const c of allAgenciesByCurrency) {
    const code = c.preferredCurrency || "USD";
    if (!currencyBuckets.has(code)) {
      currencyBuckets.set(code, { agencies: 0, mrrCents: 0 });
    }
  }

  const byCurrency = [...currencyBuckets.entries()]
    .map(([currency, b]) => ({ currency, ...b }))
    .sort((a, b) => b.agencies - a.agencies || a.currency.localeCompare(b.currency));

  // Cohorts ------------------------------------------------------------------
  // Bucket signup rows by year-month UTC. Each row contributes to:
  //  - agencies (total signups in that month)
  //  - payingAgencies (those still holding a Stripe sub)
  //  - currentMrrCents (their plan's USD price summed)
  const cohortBuckets = build12MonthCohortBuckets(now);
  for (const row of cohortAgencies) {
    const key = monthKey(row.createdAt);
    const bucket = cohortBuckets.get(key);
    if (!bucket) continue;
    bucket.agencies += 1;
    if (row.stripeSubscriptionId) {
      bucket.payingAgencies += 1;
      bucket.currentMrrCents += priceFor(row.plan) * 100;
    }
  }

  const cohorts = [...cohortBuckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([monthIso, b]) => ({
      monthIso,
      agencies: b.agencies,
      payingAgencies: b.payingAgencies,
      currentMrrCents: b.currentMrrCents,
    }));

  return {
    mrr: {
      totalCents,
      arrCents: totalCents * 12,
      payingAgencies: payingAgencies.length,
      nonPayingAgencies,
      byPlan,
      byCurrency,
    },
    invoices: {
      totalCount: totalInvoiceCount,
      paidLifetimeCents: paidInvoicesAgg._sum.amountCents ?? 0,
      paidMtdCents: paidMtdInvoicesAgg._sum.amountCents ?? 0,
      outstandingCents: outstandingInvoicesAgg._sum.amountCents ?? 0,
    },
    cohorts,
  };
}

// ============================================================
// Invoices — list + CSV
// ============================================================

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;
const INVOICE_STATUS_VALUES = ["DRAFT", "OPEN", "PAID", "VOID", "UNCOLLECTIBLE"] as const;

export const listInvoicesForRootInput = z.object({
  /** Agency-name substring (case-insensitive). */
  search: z.string().trim().min(1).max(120).optional(),
  status: z.enum(INVOICE_STATUS_VALUES).optional(),
  /** Created-after lower bound (inclusive). Accepts ISO strings via coercion. */
  createdFrom: z.coerce.date().optional(),
  /** Created-before upper bound (inclusive, widened to end-of-day below). */
  createdTo: z.coerce.date().optional(),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  skip: z.coerce.number().int().min(0).default(0),
});
/** Raw shape callers pass in (strings + numbers from query params). */
export type ListInvoicesForRootInput = z.input<typeof listInvoicesForRootInput>;
/** Parsed shape after Zod coercion — what `buildInvoiceWhere` consumes. */
type ParsedListInvoicesForRootInput = z.output<typeof listInvoicesForRootInput>;

export type InvoiceRowForRoot = {
  id: string;
  stripeInvoiceId: string;
  agencyId: string;
  agencyName: string;
  status: InvoiceStatus;
  amountCents: number;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  hostedInvoiceUrl: string | null;
  pdfUrl: string | null;
  createdAt: Date;
};

function buildInvoiceWhere(input: ParsedListInvoicesForRootInput): Prisma.InvoiceWhereInput {
  const where: Prisma.InvoiceWhereInput = {};
  if (input.status) where.status = input.status;
  if (input.search) {
    where.agency = { name: { contains: input.search, mode: "insensitive" } };
  }
  if (input.createdFrom || input.createdTo) {
    where.createdAt = {};
    if (input.createdFrom) where.createdAt.gte = input.createdFrom;
    if (input.createdTo) where.createdAt.lte = endOfDay(input.createdTo);
  }
  return where;
}

export async function listInvoicesForRoot(
  ctx: SystemAdminContext,
  rawInput: Partial<ListInvoicesForRootInput> = {},
): Promise<{ rows: InvoiceRowForRoot[]; total: number }> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const input = listInvoicesForRootInput.parse(rawInput);
  const where = buildInvoiceWhere(input);

  const [rawRows, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: input.take,
      skip: input.skip,
      select: invoiceRowSelect,
    }),
    prisma.invoice.count({ where }),
  ]);

  return { rows: rawRows.map(toInvoiceRow), total };
}

/**
 * Same filter shape as `listInvoicesForRoot` but unpaginated — used by the
 * CSV export route. A hard cap of 10,000 rows protects the response stream
 * from runaway exports; finance can re-query with tighter filters if they
 * hit it.
 */
const csvFilterInput = listInvoicesForRootInput.omit({ take: true, skip: true });
/** Raw shape callers pass in (strings + numbers from query params). */
export type StreamInvoicesForCsvInput = z.input<typeof csvFilterInput>;

export const CSV_EXPORT_HARD_CAP = 10_000;

export async function streamInvoicesForCsv(
  ctx: SystemAdminContext,
  rawInput: Partial<StreamInvoicesForCsvInput> = {},
): Promise<InvoiceRowForRoot[]> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const filters = csvFilterInput.parse(rawInput);
  const where = buildInvoiceWhere({
    ...filters,
    take: PAGE_SIZE_DEFAULT,
    skip: 0,
  });

  const rows = await prisma.invoice.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: CSV_EXPORT_HARD_CAP,
    select: invoiceRowSelect,
  });

  return rows.map(toInvoiceRow);
}

const invoiceRowSelect = {
  id: true,
  stripeInvoiceId: true,
  agencyId: true,
  status: true,
  amountCents: true,
  currency: true,
  periodStart: true,
  periodEnd: true,
  hostedInvoiceUrl: true,
  pdfUrl: true,
  createdAt: true,
  agency: { select: { name: true } },
} satisfies Prisma.InvoiceSelect;

type RawInvoiceRow = Prisma.InvoiceGetPayload<{ select: typeof invoiceRowSelect }>;

function toInvoiceRow(r: RawInvoiceRow): InvoiceRowForRoot {
  return {
    id: r.id,
    stripeInvoiceId: r.stripeInvoiceId,
    agencyId: r.agencyId,
    agencyName: r.agency.name,
    status: r.status,
    amountCents: r.amountCents,
    currency: r.currency,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    hostedInvoiceUrl: r.hostedInvoiceUrl,
    pdfUrl: r.pdfUrl,
    createdAt: r.createdAt,
  };
}

// ============================================================
// Pure date / bucket helpers — exported for tests
// ============================================================

const PLAN_ORDER_RANK: readonly Plan[] = ["SOLO", "STUDIO", "AGENCY", "NETWORK"];

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** N months before `now`'s month start. Negative `delta` walks backward. */
function monthStartOffset(now: Date, delta: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + delta, 1));
}

function monthKey(date: Date): string {
  return monthStart(date).toISOString();
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function sumPlanPriceCents(rows: Array<{ plan: Plan; _count: { _all: number } }>): number {
  return rows.reduce((acc, r) => acc + priceFor(r.plan) * 100 * r._count._all, 0);
}

const SUPPORTED_CURRENCIES = new Set(["USD", "EUR", "GBP", "CAD", "AUD"]);
function isSupportedCurrency(code: string): code is "USD" | "EUR" | "GBP" | "CAD" | "AUD" {
  return SUPPORTED_CURRENCIES.has(code);
}

/**
 * Build 12 ascending year-month buckets ending on the current month. Each
 * bucket carries zeroed counters so the cohort table still renders rows for
 * months with no signups.
 */
export function build12MonthCohortBuckets(
  now: Date,
): Map<string, { agencies: number; payingAgencies: number; currentMrrCents: number }> {
  const buckets = new Map<
    string,
    { agencies: number; payingAgencies: number; currentMrrCents: number }
  >();
  for (let i = 11; i >= 0; i--) {
    const start = monthStartOffset(now, -i);
    buckets.set(start.toISOString(), { agencies: 0, payingAgencies: 0, currentMrrCents: 0 });
  }
  return buckets;
}
