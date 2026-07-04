/**
 * The overview repo turns ~14 parallel aggregate queries into the single
 * payload the /root dashboard renders. These tests pin the load-bearing
 * math: MRR sums plan prices for paying agencies only, gross margin nets
 * AI spend out of MRR, week-bucketing covers exactly 12 chronological
 * windows ending on the current week, and the source/plan pivots survive
 * empty data.
 *
 * Aggregate correctness against a real DB is integration-test territory —
 * deferred until we stand up a test Neon branch.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    agency: { groupBy: vi.fn(), count: vi.fn() },
    member: { count: vi.fn() },
    episode: { count: vi.fn(), groupBy: vi.fn() },
    generatedOutput: { count: vi.fn() },
    usageLog: { aggregate: vi.fn() },
    outputTransition: { count: vi.fn() },
    webhookDelivery: { groupBy: vi.fn() },
    agencyUsageSnapshot: { aggregate: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/server/db/client", () => ({ prisma: mocks.prisma }));

import type { SystemAdminContext } from "@/server/auth/system";
import { ForbiddenError } from "@/server/auth/errors";
import { build12WeekBuckets, getRootOverview } from "@/server/db/system/overview";

const ctx: SystemAdminContext = {
  user: { clerkUserId: "user_test", email: "ops@example.com", name: null, imageUrl: null },
  admin: { id: "sa_1", role: "ROOT", mfaEnforced: false },
};

function resetMocks() {
  for (const table of Object.values(mocks.prisma)) {
    for (const fn of Object.values(table as Record<string, ReturnType<typeof vi.fn>>)) {
      fn.mockReset();
    }
  }
  // Defaults so the happy path doesn't need to stub every call.
  mocks.prisma.agency.groupBy.mockResolvedValue([]);
  mocks.prisma.agency.count.mockResolvedValue(0);
  mocks.prisma.member.count.mockResolvedValue(0);
  mocks.prisma.episode.count.mockResolvedValue(0);
  mocks.prisma.episode.groupBy.mockResolvedValue([]);
  mocks.prisma.generatedOutput.count.mockResolvedValue(0);
  mocks.prisma.usageLog.aggregate.mockResolvedValue({ _sum: { costCents: null } });
  mocks.prisma.outputTransition.count.mockResolvedValue(0);
  mocks.prisma.webhookDelivery.groupBy.mockResolvedValue([]);
  // Snapshot-backed defaults: empty closed period, empty 12w series.
  mocks.prisma.agencyUsageSnapshot.aggregate.mockResolvedValue({
    _sum: { episodes: null, outputs: null, costCents: null },
  });
  mocks.prisma.agencyUsageSnapshot.findMany.mockResolvedValue([]);
}

beforeEach(() => resetMocks());

describe("getRootOverview — money rollup", () => {
  it("sums plan prices in cents for PAYING agencies only (skips groupBy without sub)", async () => {
    // Two pulls of agency.groupBy in declared order:
    //   1. paying-by-plan  → drives MRR
    //   2. net-new-by-plan → drives net-new MRR MTD
    // Non-paying count is `agency.count − sum(paying)`, no extra query.
    mocks.prisma.agency.groupBy
      .mockResolvedValueOnce([
        { plan: "SOLO", _count: { _all: 1 } },
        { plan: "STUDIO", _count: { _all: 2 } },
        { plan: "NETWORK", _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([{ plan: "STUDIO", _count: { _all: 1 } }]);
    mocks.prisma.agency.count.mockResolvedValue(6);

    const result = await getRootOverview(ctx);

    // SOLO $29 × 1 + STUDIO $89 × 2 + NETWORK $299 × 1 = 29 + 178 + 299 = 506 USD = 50600 cents.
    expect(result.money.mrrCents).toBe(50600);
    expect(result.money.arrCents).toBe(50600 * 12);
    // Net new MRR: STUDIO × 1 = $89 = 8900 cents.
    expect(result.money.netNewMrrMtdCents).toBe(8900);
    expect(result.money.payingAgencies).toBe(4);
    expect(result.money.nonPayingAgencies).toBe(2);
    expect(result.money.agenciesCreatedMtd).toBe(1);
  });

  it("paying-agencies groupBy (first call) filters on stripeSubscriptionId != null", async () => {
    await getRootOverview(ctx);
    const payingCall = mocks.prisma.agency.groupBy.mock.calls[0]?.[0] as {
      where?: { stripeSubscriptionId?: unknown };
    };
    expect(payingCall.where?.stripeSubscriptionId).toEqual({ not: null });
  });

  it("net-new groupBy (second call) ANDs createdAt-this-month with stripeSubscriptionId != null", async () => {
    await getRootOverview(ctx);
    const netNewCall = mocks.prisma.agency.groupBy.mock.calls[1]?.[0] as {
      where?: { createdAt?: { gte?: Date }; stripeSubscriptionId?: unknown };
    };
    expect(netNewCall.where?.stripeSubscriptionId).toEqual({ not: null });
    expect(netNewCall.where?.createdAt?.gte).toBeInstanceOf(Date);
    // The lower bound is month-start — first of the month at 00:00 local.
    const gte = netNewCall.where?.createdAt?.gte;
    if (gte instanceof Date) {
      expect(gte.getDate()).toBe(1);
      expect(gte.getHours()).toBe(0);
      expect(gte.getMinutes()).toBe(0);
    }
  });
});

describe("getRootOverview — usage + gross margin (snapshot + live today)", () => {
  it("episodes/outputs/AI-spend MTD sums the snapshot's closed-period totals with today's live tail", async () => {
    mocks.prisma.agencyUsageSnapshot.aggregate.mockResolvedValue({
      _sum: { episodes: 40, outputs: 280, costCents: 4_000 },
    });
    mocks.prisma.episode.count.mockResolvedValue(3); // today
    mocks.prisma.generatedOutput.count.mockResolvedValue(21);
    mocks.prisma.usageLog.aggregate.mockResolvedValue({ _sum: { costCents: 1_000 } });

    const result = await getRootOverview(ctx);
    expect(result.usage.episodesMtd).toBe(43); // 40 closed + 3 today
    expect(result.usage.outputsMtd).toBe(301); // 280 + 21
    expect(result.usage.aiSpendCentsMtd).toBe(5_000); // 4_000 + 1_000
  });

  it("grossMarginCentsMtd = mrrCents − aiSpendCentsMtd (positive case)", async () => {
    mocks.prisma.agency.groupBy
      .mockResolvedValueOnce([{ plan: "STUDIO", _count: { _all: 1 } }]) // paying → MRR = $89
      .mockResolvedValueOnce([]); // net-new this month → empty
    // Closed period saw $30 in AI spend; today saw another $20.
    mocks.prisma.agencyUsageSnapshot.aggregate.mockResolvedValue({
      _sum: { episodes: null, outputs: null, costCents: 3_000 },
    });
    mocks.prisma.usageLog.aggregate.mockResolvedValue({ _sum: { costCents: 2_000 } });

    const result = await getRootOverview(ctx);
    expect(result.usage.aiSpendCentsMtd).toBe(5_000);
    // $89 × 100 = 8_900 cents; margin = 8_900 − 5_000 = 3_900 cents.
    expect(result.usage.grossMarginCentsMtd).toBe(3_900);
  });

  it("gross margin goes negative when AI spend exceeds MRR (burning case)", async () => {
    mocks.prisma.agency.groupBy
      .mockResolvedValueOnce([{ plan: "SOLO", _count: { _all: 1 } }]) // paying → MRR = $29
      .mockResolvedValueOnce([]);
    mocks.prisma.agencyUsageSnapshot.aggregate.mockResolvedValue({
      _sum: { episodes: null, outputs: null, costCents: 45_000 },
    });
    mocks.prisma.usageLog.aggregate.mockResolvedValue({ _sum: { costCents: 5_000 } });

    const result = await getRootOverview(ctx);
    // 2_900 − (45_000 + 5_000) = −47_100.
    expect(result.usage.grossMarginCentsMtd).toBe(-47_100);
  });

  it("null _sum on both snapshot AND live collapses to 0 so margin math doesn't NaN", async () => {
    // Defaults already null-out both; just assert the composition handles it.
    const result = await getRootOverview(ctx);
    expect(result.usage.aiSpendCentsMtd).toBe(0);
    expect(result.usage.episodesMtd).toBe(0);
    expect(result.usage.outputsMtd).toBe(0);
    expect(result.usage.grossMarginCentsMtd).toBe(0);
  });

  it("snapshot aggregate's where clause spans [monthStart, todayUtc) — closed days only", async () => {
    await getRootOverview(ctx);
    const call = mocks.prisma.agencyUsageSnapshot.aggregate.mock.calls[0]?.[0] as {
      where: { date: { gte?: Date; lt?: Date } };
    };
    expect(call.where.date.gte).toBeInstanceOf(Date);
    expect(call.where.date.lt).toBeInstanceOf(Date);
    // Both bounds anchor to midnight: lower at month-start, upper at today UTC midnight.
    const lt = call.where.date.lt;
    if (lt instanceof Date) {
      expect(lt.getUTCHours()).toBe(0);
      expect(lt.getUTCMinutes()).toBe(0);
      expect(lt.getUTCMilliseconds()).toBe(0);
    }
  });
});

describe("getRootOverview — health", () => {
  it("pipelineFailures24h counts OutputTransition with toStatus=FAILED in last 24h", async () => {
    mocks.prisma.outputTransition.count.mockResolvedValue(7);
    const result = await getRootOverview(ctx);
    const call = mocks.prisma.outputTransition.count.mock.calls[0]?.[0] as {
      where?: { toStatus?: unknown; createdAt?: { gte?: Date } };
    };
    expect(call.where?.toStatus).toBe("FAILED");
    expect(call.where?.createdAt?.gte).toBeInstanceOf(Date);
    expect(result.health.pipelineFailures24h).toBe(7);
  });

  it("webhookDeliveries24h groups by source and sorts descending by count", async () => {
    mocks.prisma.webhookDelivery.groupBy.mockResolvedValue([
      { source: "clerk", _count: { _all: 3 } },
      { source: "stripe", _count: { _all: 12 } },
      { source: "resend", _count: { _all: 1 } },
    ]);
    const result = await getRootOverview(ctx);
    expect(result.health.webhookDeliveries24h).toEqual([
      { source: "stripe", count: 12 },
      { source: "clerk", count: 3 },
      { source: "resend", count: 1 },
    ]);
  });
});

describe("getRootOverview — charts", () => {
  it("episodes-by-source pivot zero-fills every TranscriptSource", async () => {
    mocks.prisma.episode.groupBy.mockResolvedValue([
      { source: "RSS", _count: { _all: 5 } },
      { source: "UPLOAD", _count: { _all: 2 } },
    ]);
    const result = await getRootOverview(ctx);
    // All 4 sources present, missing ones zero-filled, declared order preserved.
    const sources = result.charts.episodesBySource.map((r) => r.source);
    expect(sources).toEqual(["PASTE", "UPLOAD", "RSS", "YOUTUBE"]);
    const map = Object.fromEntries(result.charts.episodesBySource.map((r) => [r.source, r.count]));
    expect(map).toEqual({ PASTE: 0, UPLOAD: 2, RSS: 5, YOUTUBE: 0 });
  });

  it("outputsByPlanLast12Weeks returns exactly 12 chronological buckets", async () => {
    const result = await getRootOverview(ctx);
    expect(result.charts.outputsByPlanLast12Weeks).toHaveLength(12);
    // Buckets are sorted ascending — first ISO string < last.
    const first = result.charts.outputsByPlanLast12Weeks[0].weekStartIso;
    const last = result.charts.outputsByPlanLast12Weeks[11].weekStartIso;
    expect(first < last).toBe(true);
    // Each bucket carries all three plans, zero-filled, with total 0.
    for (const bucket of result.charts.outputsByPlanLast12Weeks) {
      expect(bucket.counts.SOLO).toBe(0);
      expect(bucket.counts.STUDIO).toBe(0);
      expect(bucket.counts.NETWORK).toBe(0);
      expect(bucket.total).toBe(0);
    }
  });

  it("buckets sum snapshot rows by week + plan and exclude today's partial week", async () => {
    // Fixture: 4 outputs in a snapshot dated 10 days ago on a STUDIO agency.
    // Bucketing should land them in the bucket two weeks back (week before
    // the current one).
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
    mocks.prisma.agencyUsageSnapshot.findMany.mockResolvedValue([
      { date: tenDaysAgo, plan: "STUDIO", outputs: 4 },
      // A row dated today should be excluded by the WHERE (`date < todayUtc`)
      // — but the test doesn't have control over that filter, only the
      // returned rows. Simulate by NOT returning a today-row.
    ]);

    const result = await getRootOverview(ctx);
    const nonZero = result.charts.outputsByPlanLast12Weeks.filter((b) => b.total > 0);
    expect(nonZero).toHaveLength(1);
    expect(nonZero[0].counts.STUDIO).toBe(4);
    expect(nonZero[0].total).toBe(4);
    // Last bucket is the current week — should be empty since we never
    // snapshot today.
    expect(result.charts.outputsByPlanLast12Weeks[11].total).toBe(0);
  });

  it("multiple agencies' snapshot rows merge into the same week bucket per plan", async () => {
    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    mocks.prisma.agencyUsageSnapshot.findMany.mockResolvedValue([
      { date: fourteenDaysAgo, plan: "STUDIO", outputs: 3 },
      { date: fourteenDaysAgo, plan: "NETWORK", outputs: 11 },
      {
        date: new Date(fourteenDaysAgo.getTime() + 24 * 60 * 60 * 1000),
        plan: "STUDIO",
        outputs: 2,
      },
    ]);
    const result = await getRootOverview(ctx);
    const nonZero = result.charts.outputsByPlanLast12Weeks.filter((b) => b.total > 0);
    expect(nonZero).toHaveLength(1);
    expect(nonZero[0].counts.STUDIO).toBe(5); // 3 + 2 in the same week
    expect(nonZero[0].counts.NETWORK).toBe(11);
    expect(nonZero[0].total).toBe(16);
  });
});

describe("getRootOverview — role gate", () => {
  it("rejects callers outside SYSTEM_READ_ROLES", async () => {
    const broken = { ...ctx, admin: { ...ctx.admin, role: "GHOST" as never } };
    await expect(getRootOverview(broken)).rejects.toBeInstanceOf(ForbiddenError);
    // None of the parallel queries should have fired.
    expect(mocks.prisma.agency.groupBy).not.toHaveBeenCalled();
  });

  it("accepts every system read role", async () => {
    for (const role of ["ROOT", "OPERATOR", "SUPPORT", "ANALYST"] as const) {
      const result = await getRootOverview({ ...ctx, admin: { ...ctx.admin, role } });
      expect(result).toBeDefined();
    }
  });
});

describe("build12WeekBuckets", () => {
  it("returns a Map with 12 entries", () => {
    const result = build12WeekBuckets(new Date("2026-06-30T12:00:00Z"));
    expect(result.size).toBe(12);
  });

  it("all keys anchor to Monday 00:00 UTC", () => {
    const result = build12WeekBuckets(new Date("2026-06-30T12:00:00Z"));
    for (const key of result.keys()) {
      const d = new Date(key);
      // UTC Monday = 1; ISO time of day = midnight UTC.
      expect(d.getUTCDay()).toBe(1);
      expect(d.getUTCHours()).toBe(0);
      expect(d.getUTCMinutes()).toBe(0);
      expect(d.getUTCSeconds()).toBe(0);
      expect(d.getUTCMilliseconds()).toBe(0);
    }
  });

  it("consecutive bucket starts are exactly 7 UTC days apart", () => {
    const result = build12WeekBuckets(new Date("2026-06-30T12:00:00Z"));
    const keys = [...result.keys()];
    for (let i = 1; i < keys.length; i++) {
      const prev = new Date(keys[i - 1]).getTime();
      const cur = new Date(keys[i]).getTime();
      expect(cur - prev).toBe(7 * 24 * 60 * 60 * 1000);
    }
  });
});
