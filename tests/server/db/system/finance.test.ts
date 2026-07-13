/**
 * Finance dashboard repo helpers.
 *
 * Pins the load-bearing math:
 *   - MRR per-plan + per-currency rollups vs. `lib/plans.ts` price source
 *   - Signup cohort bucketing (12 months ascending, zero-fill empty months)
 *   - Invoice filter where-clause shape (status, agency search, date range)
 *   - CSV export hard cap + filter passthrough
 *
 * Aggregate math reconciliation: `mrr.totalCents` MUST equal the sum of
 * every `byPlan` row's `mrrCents`. The PLAN exit criteria for the finance
 * dashboard is ±1% against Stripe — this test enforces internal coherence,
 * the live Stripe reconciliation is a manual check.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceStatus, Plan } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  agencyGroupBy: vi.fn(),
  agencyFindMany: vi.fn(),
  agencyCount: vi.fn(),
  invoiceAggregate: vi.fn(),
  invoiceCount: vi.fn(),
  invoiceFindMany: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    agency: {
      groupBy: mocks.agencyGroupBy,
      findMany: mocks.agencyFindMany,
      count: mocks.agencyCount,
    },
    invoice: {
      aggregate: mocks.invoiceAggregate,
      count: mocks.invoiceCount,
      findMany: mocks.invoiceFindMany,
    },
  },
}));

import { priceFor } from "@/lib/plans";
import { ForbiddenError } from "@/server/auth/errors";
import type { SystemAdminContext } from "@/server/auth/system";
import {
  build12MonthCohortBuckets,
  CSV_EXPORT_HARD_CAP,
  getFinanceSummary,
  listInvoicesForRoot,
  streamInvoicesForCsv,
} from "@/server/db/system/finance";

function ctx(role: SystemAdminContext["admin"]["role"] = "ROOT"): SystemAdminContext {
  return {
    user: { clerkUserId: "user_1", email: "ops@example.com", name: null, imageUrl: null },
    admin: { id: "sa_1", role, mfaEnforced: true },
  };
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

// ============================================================
// build12MonthCohortBuckets — pure helper
// ============================================================

describe("build12MonthCohortBuckets", () => {
  it("produces 12 ascending year-month buckets ending on `now`'s month", () => {
    const now = new Date("2026-06-15T10:00:00.000Z");
    const buckets = build12MonthCohortBuckets(now);
    const keys = [...buckets.keys()];

    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe("2025-07-01T00:00:00.000Z");
    expect(keys[11]).toBe("2026-06-01T00:00:00.000Z");
  });

  it("each bucket starts zeroed", () => {
    const buckets = build12MonthCohortBuckets(new Date("2026-06-15T00:00:00Z"));
    for (const bucket of buckets.values()) {
      expect(bucket).toEqual({ agencies: 0, payingAgencies: 0, currentMrrCents: 0 });
    }
  });

  it("handles year boundaries — Jan now → Feb-prev-year is the oldest bucket", () => {
    const now = new Date("2026-01-10T00:00:00Z");
    const buckets = build12MonthCohortBuckets(now);
    const keys = [...buckets.keys()];
    expect(keys[0]).toBe("2025-02-01T00:00:00.000Z");
    expect(keys[11]).toBe("2026-01-01T00:00:00.000Z");
  });
});

// ============================================================
// getFinanceSummary
// ============================================================

/**
 * `agency.findMany` is called twice inside `getFinanceSummary` with
 * different `select` shapes. The mock discriminates so the cohort
 * helpers don't try to `getUTCFullYear()` a paying-agency row that
 * has no `createdAt`.
 */
function mockAgencyFindMany(opts: {
  paying?: Array<{ plan: Plan; preferredCurrency: string }>;
  cohorts?: Array<{ createdAt: Date; plan: Plan; stripeSubscriptionId: string | null }>;
}): void {
  mocks.agencyFindMany.mockImplementation(
    async (args: { select?: { createdAt?: boolean; preferredCurrency?: boolean } }) => {
      if (args.select?.createdAt) return opts.cohorts ?? [];
      if (args.select?.preferredCurrency) return opts.paying ?? [];
      return [];
    },
  );
}

describe("getFinanceSummary — MRR rollup", () => {
  beforeEach(() => {
    // Defaults — every test below overrides what it cares about.
    mocks.agencyGroupBy.mockResolvedValue([]);
    mockAgencyFindMany({});
    mocks.agencyCount.mockResolvedValue(0);
    mocks.invoiceAggregate.mockResolvedValue({ _sum: { amountCents: null } });
    mocks.invoiceCount.mockResolvedValue(0);
  });

  it("throws ForbiddenError when the admin role isn't in SYSTEM_READ_ROLES", async () => {
    // Manufacture an invalid role to confirm the gate is wired.
    const bad = { ...ctx(), admin: { ...ctx().admin, role: "UNKNOWN" as never } };
    await expect(getFinanceSummary(bad)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("sums byPlan rows to mrr.totalCents (internal coherence)", async () => {
    // 5 STUDIO paying + 2 NETWORK paying — totalCents must equal byPlan sum.
    mocks.agencyGroupBy.mockImplementation(async (args: { by: string[] }) => {
      if (args.by.includes("plan")) {
        return [
          { plan: "STUDIO" as Plan, _count: { _all: 5 } },
          { plan: "NETWORK" as Plan, _count: { _all: 2 } },
        ];
      }
      if (args.by.includes("preferredCurrency")) {
        return [{ preferredCurrency: "USD", _count: { _all: 7 } }];
      }
      return [];
    });
    mockAgencyFindMany({
      paying: [
        ...Array.from({ length: 5 }, () => ({
          plan: "STUDIO" as Plan,
          preferredCurrency: "USD",
        })),
        ...Array.from({ length: 2 }, () => ({
          plan: "NETWORK" as Plan,
          preferredCurrency: "USD",
        })),
      ],
    });

    const summary = await getFinanceSummary(ctx());

    const expectedStudio = 5 * priceFor("STUDIO") * 100;
    const expectedNetwork = 2 * priceFor("NETWORK") * 100;
    expect(summary.mrr.byPlan).toEqual([
      { plan: "SOLO", agencies: 0, mrrCents: 0 },
      { plan: "STUDIO", agencies: 5, mrrCents: expectedStudio },
      { plan: "AGENCY", agencies: 0, mrrCents: 0 },
      { plan: "NETWORK", agencies: 2, mrrCents: expectedNetwork },
    ]);
    expect(summary.mrr.totalCents).toBe(expectedStudio + expectedNetwork);
    expect(summary.mrr.arrCents).toBe((expectedStudio + expectedNetwork) * 12);
    expect(summary.mrr.payingAgencies).toBe(7);
  });

  it("buckets by-currency MRR using each agency's preferredCurrency", async () => {
    mocks.agencyGroupBy.mockImplementation(async (args: { by: string[] }) => {
      if (args.by.includes("plan")) {
        return [
          { plan: "STUDIO" as Plan, _count: { _all: 3 } },
          { plan: "NETWORK" as Plan, _count: { _all: 1 } },
        ];
      }
      if (args.by.includes("preferredCurrency")) {
        return [
          { preferredCurrency: "USD", _count: { _all: 2 } },
          { preferredCurrency: "EUR", _count: { _all: 2 } },
        ];
      }
      return [];
    });
    mockAgencyFindMany({
      paying: [
        { plan: "STUDIO" as Plan, preferredCurrency: "USD" },
        { plan: "STUDIO" as Plan, preferredCurrency: "USD" },
        { plan: "STUDIO" as Plan, preferredCurrency: "EUR" },
        { plan: "NETWORK" as Plan, preferredCurrency: "EUR" },
      ],
    });

    const summary = await getFinanceSummary(ctx());

    const usdRow = summary.mrr.byCurrency.find((r) => r.currency === "USD");
    const eurRow = summary.mrr.byCurrency.find((r) => r.currency === "EUR");
    expect(usdRow).toEqual({
      currency: "USD",
      agencies: 2,
      mrrCents: 2 * priceFor("STUDIO", "USD") * 100,
    });
    expect(eurRow).toEqual({
      currency: "EUR",
      agencies: 2,
      mrrCents: priceFor("STUDIO", "EUR") * 100 + priceFor("NETWORK", "EUR") * 100,
    });
  });

  it("falls back to USD pricing for an unrecognized currency code", async () => {
    mocks.agencyGroupBy.mockImplementation(async (args: { by: string[] }) => {
      if (args.by.includes("plan")) {
        return [{ plan: "STUDIO" as Plan, _count: { _all: 1 } }];
      }
      if (args.by.includes("preferredCurrency")) {
        return [{ preferredCurrency: "XYZ", _count: { _all: 1 } }];
      }
      return [];
    });
    mockAgencyFindMany({
      paying: [{ plan: "STUDIO" as Plan, preferredCurrency: "XYZ" }],
    });

    const summary = await getFinanceSummary(ctx());
    const xyz = summary.mrr.byCurrency.find((r) => r.currency === "XYZ");
    expect(xyz?.mrrCents).toBe(priceFor("STUDIO", "USD") * 100);
  });

  it("surfaces invoice rollups verbatim from the aggregate query", async () => {
    let call = 0;
    mocks.invoiceAggregate.mockImplementation(async () => {
      call += 1;
      // Order matches the Promise.all in getFinanceSummary:
      // 1=PAID lifetime, 2=PAID MTD, 3=OPEN outstanding.
      if (call === 1) return { _sum: { amountCents: 1_234_500 } };
      if (call === 2) return { _sum: { amountCents: 50_000 } };
      return { _sum: { amountCents: 9_900 } };
    });
    mocks.invoiceCount.mockResolvedValue(42);

    const summary = await getFinanceSummary(ctx());
    expect(summary.invoices).toEqual({
      totalCount: 42,
      paidLifetimeCents: 1_234_500,
      paidMtdCents: 50_000,
      outstandingCents: 9_900,
    });
  });

  it("collapses null aggregate sums to 0 (defensive on empty tables)", async () => {
    mocks.invoiceAggregate.mockResolvedValue({ _sum: { amountCents: null } });
    const summary = await getFinanceSummary(ctx());
    expect(summary.invoices.paidLifetimeCents).toBe(0);
    expect(summary.invoices.paidMtdCents).toBe(0);
    expect(summary.invoices.outstandingCents).toBe(0);
  });
});

// ============================================================
// Cohort grouping
// ============================================================

describe("getFinanceSummary — cohorts", () => {
  beforeEach(() => {
    mocks.agencyGroupBy.mockResolvedValue([]);
    mockAgencyFindMany({
      cohorts: [
        {
          createdAt: new Date("2026-05-15T10:00:00Z"),
          plan: "STUDIO" as Plan,
          stripeSubscriptionId: "sub_a",
        },
        {
          createdAt: new Date("2026-05-20T10:00:00Z"),
          plan: "STUDIO" as Plan,
          stripeSubscriptionId: null,
        },
        {
          createdAt: new Date("2026-06-05T00:00:00Z"),
          plan: "NETWORK" as Plan,
          stripeSubscriptionId: "sub_b",
        },
      ],
    });
    mocks.agencyCount.mockResolvedValue(0);
    mocks.invoiceAggregate.mockResolvedValue({ _sum: { amountCents: null } });
    mocks.invoiceCount.mockResolvedValue(0);
  });

  it("buckets agencies into 12 ascending year-months with current MRR", async () => {
    // The test relies on `now` being deterministic relative to the fixture
    // months — May/June 2026. Lock with fake timers.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T00:00:00Z"));
    try {
      const summary = await getFinanceSummary(ctx());

      expect(summary.cohorts).toHaveLength(12);
      const may = summary.cohorts.find((c) => c.monthIso === "2026-05-01T00:00:00.000Z");
      const june = summary.cohorts.find((c) => c.monthIso === "2026-06-01T00:00:00.000Z");
      expect(may).toEqual({
        monthIso: "2026-05-01T00:00:00.000Z",
        agencies: 2,
        payingAgencies: 1, // only one had a sub
        currentMrrCents: priceFor("STUDIO") * 100,
      });
      expect(june).toEqual({
        monthIso: "2026-06-01T00:00:00.000Z",
        agencies: 1,
        payingAgencies: 1,
        currentMrrCents: priceFor("NETWORK") * 100,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

// ============================================================
// listInvoicesForRoot — filter shape
// ============================================================

describe("listInvoicesForRoot — where-clause", () => {
  beforeEach(() => {
    mocks.invoiceFindMany.mockResolvedValue([]);
    mocks.invoiceCount.mockResolvedValue(0);
  });

  it("filters by status, agency search, and date range", async () => {
    await listInvoicesForRoot(ctx(), {
      status: "PAID",
      search: "Acme",
      createdFrom: "2026-01-01",
      createdTo: "2026-03-31",
      take: 25,
      skip: 0,
    });

    const findArgs = mocks.invoiceFindMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      take: number;
      skip: number;
    };
    expect(findArgs.where.status).toBe("PAID");
    expect(findArgs.where.agency).toEqual({
      name: { contains: "Acme", mode: "insensitive" },
    });
    const createdAt = findArgs.where.createdAt as { gte?: Date; lte?: Date };
    expect(createdAt.gte).toBeInstanceOf(Date);
    expect(createdAt.lte).toBeInstanceOf(Date);
    expect(findArgs.take).toBe(25);
    expect(findArgs.skip).toBe(0);
  });

  it("defaults take/skip when omitted", async () => {
    await listInvoicesForRoot(ctx(), {});
    const findArgs = mocks.invoiceFindMany.mock.calls[0]?.[0] as { take: number; skip: number };
    expect(findArgs.take).toBe(25);
    expect(findArgs.skip).toBe(0);
  });

  it("returns the raw row count from invoice.count", async () => {
    mocks.invoiceCount.mockResolvedValue(137);
    const result = await listInvoicesForRoot(ctx(), {});
    expect(result.total).toBe(137);
  });
});

// ============================================================
// streamInvoicesForCsv
// ============================================================

describe("streamInvoicesForCsv — hard cap + filter passthrough", () => {
  it("applies the CSV hard cap as the findMany `take`", async () => {
    mocks.invoiceFindMany.mockResolvedValue([]);

    await streamInvoicesForCsv(ctx(), { status: "PAID" satisfies InvoiceStatus });

    const findArgs = mocks.invoiceFindMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      take: number;
    };
    expect(findArgs.take).toBe(CSV_EXPORT_HARD_CAP);
    expect(findArgs.where.status).toBe("PAID");
  });

  it("propagates agency-name search into the where", async () => {
    mocks.invoiceFindMany.mockResolvedValue([]);
    await streamInvoicesForCsv(ctx(), { search: "Acme" });
    const findArgs = mocks.invoiceFindMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(findArgs.where.agency).toEqual({ name: { contains: "Acme", mode: "insensitive" } });
  });
});
