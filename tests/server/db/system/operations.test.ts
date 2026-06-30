/**
 * Phase 3.6.8 — operations dashboard repo helpers.
 *
 * Pure-helper coverage: month-end forecast math + 30-day daily-series
 * bucket builder. The orchestration in `getOperationsSummary` is mostly
 * Prisma fan-out; we add a single happy-path orchestration test that
 * proves the margin-vs-MRR math composes with `lib/plans.ts` correctly
 * (the only non-trivial join in the aggregator).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  usageLogAggregate: vi.fn(),
  usageLogGroupBy: vi.fn(),
  episodeCount: vi.fn(),
  episodeFindMany: vi.fn(),
  webhookGroupBy: vi.fn(),
  webhookFindMany: vi.fn(),
  agencyFindMany: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    usageLog: {
      aggregate: mocks.usageLogAggregate,
      groupBy: mocks.usageLogGroupBy,
    },
    episode: {
      count: mocks.episodeCount,
      findMany: mocks.episodeFindMany,
    },
    webhookDelivery: {
      groupBy: mocks.webhookGroupBy,
      findMany: mocks.webhookFindMany,
    },
    agency: {
      findMany: mocks.agencyFindMany,
    },
  },
}));

import { priceFor } from "@/lib/plans";
import { ForbiddenError } from "@/server/auth/errors";
import type { SystemAdminContext } from "@/server/auth/system";
import {
  bucketDailySeries,
  forecastMonthEnd,
  getOperationsSummary,
} from "@/server/db/system/operations";

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
// forecastMonthEnd
// ============================================================

describe("forecastMonthEnd", () => {
  it("returns 0 when MTD is 0 (no division-by-zero, no false projection)", () => {
    expect(forecastMonthEnd(new Date("2026-06-15T00:00:00Z"), 0)).toBe(0);
  });

  it("paces MTD spend straight-line to month end", () => {
    // June has 30 days. On day 15, MTD 15_000 → forecast 30_000.
    const now = new Date("2026-06-15T00:00:00Z");
    expect(forecastMonthEnd(now, 15_000)).toBe(30_000);
  });

  it("projects day-1 spend at the straight-line full-month rate", () => {
    // Day 1, MTD 1000, June (30 days) → 30000. Day 2 → 15000 because we've
    // now seen twice as much elapsed time for the same spend.
    const day1 = forecastMonthEnd(new Date("2026-06-01T00:00:00Z"), 1000);
    const day2 = forecastMonthEnd(new Date("2026-06-02T00:00:00Z"), 1000);
    expect(day1).toBe(30_000); // 1000 × 30 / 1
    expect(day2).toBe(15_000); // 1000 × 30 / 2
  });

  it("respects each month's calendar length", () => {
    // Feb 2026 has 28 days. Day 14, MTD 100 → 200.
    const feb = forecastMonthEnd(new Date("2026-02-14T00:00:00Z"), 100);
    expect(feb).toBe(200);
    // Jul 2026 has 31 days. Day 14, MTD 100 → 221 (rounded from 221.43).
    const jul = forecastMonthEnd(new Date("2026-07-14T00:00:00Z"), 100);
    expect(jul).toBe(221);
  });
});

// ============================================================
// bucketDailySeries
// ============================================================

describe("bucketDailySeries", () => {
  it("zero-fills the whole range when there are no rows", () => {
    const from = new Date("2026-06-01T00:00:00Z");
    const to = new Date("2026-06-05T00:00:00Z");
    const result = bucketDailySeries(from, to, []);
    expect(result).toHaveLength(5); // 4 full days + the inclusive `to` seed
    for (const row of result) expect(row.count).toBe(0);
  });

  it("counts events into their UTC day bucket", () => {
    const from = new Date("2026-06-01T00:00:00Z");
    const to = new Date("2026-06-03T00:00:00Z");
    const result = bucketDailySeries(from, to, [
      { processedAt: new Date("2026-06-01T05:00:00Z") },
      { processedAt: new Date("2026-06-01T23:59:00Z") },
      { processedAt: new Date("2026-06-03T01:00:00Z") },
    ]);
    expect(result.find((d) => d.dayIso === "2026-06-01T00:00:00.000Z")?.count).toBe(2);
    expect(result.find((d) => d.dayIso === "2026-06-02T00:00:00.000Z")?.count).toBe(0);
    expect(result.find((d) => d.dayIso === "2026-06-03T00:00:00.000Z")?.count).toBe(1);
  });

  it("returns an ascending series", () => {
    const from = new Date("2026-06-01T00:00:00Z");
    const to = new Date("2026-06-05T00:00:00Z");
    const result = bucketDailySeries(from, to, []);
    const isoStamps = result.map((r) => r.dayIso);
    expect(isoStamps).toEqual([...isoStamps].sort());
  });

  it("ignores out-of-range rows (defensive against caller drift)", () => {
    const from = new Date("2026-06-10T00:00:00Z");
    const to = new Date("2026-06-12T00:00:00Z");
    const result = bucketDailySeries(from, to, [
      { processedAt: new Date("2026-05-01T00:00:00Z") }, // before the window
      { processedAt: new Date("2026-07-01T00:00:00Z") }, // after the window
    ]);
    const total = result.reduce((acc, r) => acc + r.count, 0);
    expect(total).toBe(0);
  });
});

// ============================================================
// getOperationsSummary — happy-path orchestration
// ============================================================

describe("getOperationsSummary", () => {
  beforeEach(() => {
    mocks.usageLogAggregate.mockResolvedValue({ _sum: { costCents: 0 } });
    mocks.usageLogGroupBy.mockResolvedValue([]);
    mocks.episodeCount.mockResolvedValue(0);
    mocks.episodeFindMany.mockResolvedValue([]);
    mocks.webhookGroupBy.mockResolvedValue([]);
    mocks.webhookFindMany.mockResolvedValue([]);
    mocks.agencyFindMany.mockResolvedValue([]);
  });

  it("throws ForbiddenError for an admin outside SYSTEM_READ_ROLES", async () => {
    const bad = { ...ctx(), admin: { ...ctx().admin, role: "UNKNOWN" as never } };
    await expect(getOperationsSummary(bad)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("joins top-agency spend with the agency's plan price to compute margin", async () => {
    // Three usageLogAggregate calls: today, MTD, lifetime — supply each via
    // sequential resolves.
    let call = 0;
    mocks.usageLogAggregate.mockImplementation(async () => {
      call += 1;
      if (call === 1) return { _sum: { costCents: 200 } };
      if (call === 2) return { _sum: { costCents: 1000 } };
      return { _sum: { costCents: 50_000 } };
    });
    mocks.usageLogGroupBy.mockImplementation(async (args: { by: string[] }) => {
      if (args.by.includes("model")) {
        return [
          { model: "claude-sonnet-4-6", _sum: { costCents: 700 }, _count: { _all: 5 } },
          { model: "claude-opus-4-7", _sum: { costCents: 300 }, _count: { _all: 1 } },
        ];
      }
      // by: ["agencyId"] — top 20 by spend.
      return [
        { agencyId: "agency_a", _sum: { costCents: 600 } },
        { agencyId: "agency_b", _sum: { costCents: 400 } },
      ];
    });
    mocks.agencyFindMany.mockResolvedValue([
      { id: "agency_a", name: "Big Spender", plan: "AGENCY" satisfies Plan },
      { id: "agency_b", name: "Cheap Studio", plan: "STUDIO" satisfies Plan },
    ]);

    const summary = await getOperationsSummary(ctx());

    expect(summary.aiSpend.todayCents).toBe(200);
    expect(summary.aiSpend.mtdCents).toBe(1000);
    expect(summary.aiSpend.lifetimeCents).toBe(50_000);
    expect(summary.aiSpend.byModel).toEqual([
      { model: "claude-sonnet-4-6", calls: 5, costCents: 700 },
      { model: "claude-opus-4-7", calls: 1, costCents: 300 },
    ]);

    const agencyMrr = priceFor("AGENCY") * 100;
    const studioMrr = priceFor("STUDIO") * 100;
    expect(summary.aiSpend.topAgencies).toEqual([
      {
        agencyId: "agency_a",
        agencyName: "Big Spender",
        plan: "AGENCY",
        costCentsMtd: 600,
        mrrCentsMonthly: agencyMrr,
        marginCentsMtd: agencyMrr - 600,
      },
      {
        agencyId: "agency_b",
        agencyName: "Cheap Studio",
        plan: "STUDIO",
        costCentsMtd: 400,
        mrrCentsMonthly: studioMrr,
        marginCentsMtd: studioMrr - 400,
      },
    ]);
  });

  it("drops top-agency rows whose agency row is missing (race against hard-delete)", async () => {
    let call = 0;
    mocks.usageLogAggregate.mockImplementation(async () => {
      call += 1;
      return { _sum: { costCents: call * 100 } };
    });
    mocks.usageLogGroupBy.mockImplementation(async (args: { by: string[] }) => {
      if (args.by.includes("agencyId")) {
        return [
          { agencyId: "agency_live", _sum: { costCents: 500 } },
          { agencyId: "agency_ghost", _sum: { costCents: 400 } },
        ];
      }
      return [];
    });
    mocks.agencyFindMany.mockResolvedValue([
      { id: "agency_live", name: "Still Here", plan: "STUDIO" satisfies Plan },
      // agency_ghost intentionally absent.
    ]);

    const summary = await getOperationsSummary(ctx());

    expect(summary.aiSpend.topAgencies.map((r) => r.agencyId)).toEqual(["agency_live"]);
  });

  it("shapes recentFailures by joining show → client → agency for the agency name", async () => {
    mocks.episodeFindMany.mockResolvedValue([
      {
        id: "ep_1",
        title: "Episode 12",
        failureReason: "Whisper 429 — retries exhausted",
        updatedAt: new Date("2026-06-15T10:00:00Z"),
        show: {
          client: {
            agencyId: "agency_x",
            agency: { name: "Failing Agency" },
          },
        },
      },
    ]);

    const summary = await getOperationsSummary(ctx());

    expect(summary.queue.recentFailures).toEqual([
      {
        episodeId: "ep_1",
        episodeTitle: "Episode 12",
        agencyId: "agency_x",
        agencyName: "Failing Agency",
        failureReason: "Whisper 429 — retries exhausted",
        updatedAt: new Date("2026-06-15T10:00:00Z"),
      },
    ]);
  });

  it("sorts webhook bySource30d by count desc and zero-fills the daily series to 30 entries", async () => {
    mocks.webhookGroupBy.mockResolvedValue([
      { source: "stripe", _count: { _all: 12 } },
      { source: "clerk", _count: { _all: 87 } },
    ]);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T12:00:00Z"));
    try {
      const summary = await getOperationsSummary(ctx());
      expect(summary.webhooks.bySource30d).toEqual([
        { source: "clerk", count: 87 },
        { source: "stripe", count: 12 },
      ]);
      // 30 days back through today inclusive = 30 entries.
      expect(summary.webhooks.daily30d).toHaveLength(30);
      expect(summary.webhooks.daily30d.every((d) => d.count === 0)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
