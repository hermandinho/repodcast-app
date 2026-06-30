/**
 * Tests for the snapshot rollup helpers (Phase 3.6.18 step 4).
 *
 * The date math is pure and gets pinned hard — the cron's correctness rides
 * on UTC midnight anchoring. The `rollupAgencyForDay` worker is mocked at
 * the prisma boundary so we can pin the upsert shape + assert the four
 * parallel reads use the right date window.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    episode: { count: vi.fn() },
    generatedOutput: { count: vi.fn() },
    usageLog: { aggregate: vi.fn() },
    invoice: { aggregate: vi.fn() },
    agencyUsageSnapshot: { upsert: vi.fn() },
  },
}));

vi.mock("@/server/db/client", () => ({ prisma: mocks.prisma }));

import {
  priorUtcDay,
  rollupAgencyForDay,
  utcDayRange,
  utcDayStart,
} from "@/server/db/system/rollup";

beforeEach(() => {
  for (const table of Object.values(mocks.prisma)) {
    for (const fn of Object.values(table as Record<string, ReturnType<typeof vi.fn>>)) {
      fn.mockReset();
    }
  }
  mocks.prisma.episode.count.mockResolvedValue(0);
  mocks.prisma.generatedOutput.count.mockResolvedValue(0);
  mocks.prisma.usageLog.aggregate.mockResolvedValue({ _sum: { costCents: null } });
  mocks.prisma.invoice.aggregate.mockResolvedValue({ _sum: { amountCents: null } });
  mocks.prisma.agencyUsageSnapshot.upsert.mockResolvedValue({ id: "snap_1" });
});

describe("utcDayStart", () => {
  it("returns midnight UTC of the same calendar day", () => {
    const input = new Date("2026-06-30T14:23:55.123Z");
    const result = utcDayStart(input);
    expect(result.toISOString()).toBe("2026-06-30T00:00:00.000Z");
  });

  it("is idempotent — passing a midnight value returns the same instant", () => {
    const midnight = new Date("2026-06-30T00:00:00.000Z");
    expect(utcDayStart(midnight).toISOString()).toBe(midnight.toISOString());
  });

  it("does NOT shift based on local time — only UTC matters", () => {
    // 23:00 UTC on day N stays on day N, even if the local clock is on day N+1.
    const lateUtc = new Date("2026-06-30T23:30:00.000Z");
    expect(utcDayStart(lateUtc).toISOString()).toBe("2026-06-30T00:00:00.000Z");
  });
});

describe("priorUtcDay", () => {
  it("returns midnight UTC of the day BEFORE the one containing `now`", () => {
    const now = new Date("2026-06-30T02:00:00.000Z");
    expect(priorUtcDay(now).toISOString()).toBe("2026-06-29T00:00:00.000Z");
  });

  it("works across month boundaries", () => {
    const now = new Date("2026-07-01T02:00:00.000Z");
    expect(priorUtcDay(now).toISOString()).toBe("2026-06-30T00:00:00.000Z");
  });

  it("works across year boundaries", () => {
    const now = new Date("2027-01-01T02:00:00.000Z");
    expect(priorUtcDay(now).toISOString()).toBe("2026-12-31T00:00:00.000Z");
  });
});

describe("utcDayRange", () => {
  it("returns midnight UTC for each day in [from, to)", () => {
    const from = new Date("2026-06-28T00:00:00.000Z");
    const to = new Date("2026-07-01T00:00:00.000Z");
    const days = utcDayRange(from, to);
    expect(days.map((d) => d.toISOString())).toEqual([
      "2026-06-28T00:00:00.000Z",
      "2026-06-29T00:00:00.000Z",
      "2026-06-30T00:00:00.000Z",
    ]);
  });

  it("excludes the `to` upper bound (half-open interval)", () => {
    const from = new Date("2026-06-30T00:00:00.000Z");
    const to = new Date("2026-07-01T00:00:00.000Z");
    expect(utcDayRange(from, to)).toHaveLength(1);
  });

  it("returns [] when from >= to", () => {
    const same = new Date("2026-06-30T00:00:00.000Z");
    expect(utcDayRange(same, same)).toEqual([]);
    const after = new Date("2026-07-01T00:00:00.000Z");
    expect(utcDayRange(after, same)).toEqual([]);
  });

  it("normalises non-midnight bounds — doesn't double-count or skip", () => {
    // A caller passing 23:00 UTC on day N as `from` should still get day N.
    const from = new Date("2026-06-28T23:00:00.000Z");
    const to = new Date("2026-06-30T00:00:00.000Z");
    const days = utcDayRange(from, to);
    expect(days.map((d) => d.toISOString())).toEqual([
      "2026-06-28T00:00:00.000Z",
      "2026-06-29T00:00:00.000Z",
    ]);
  });
});

describe("rollupAgencyForDay", () => {
  it("counts episodes/outputs/spend/revenue inside [dayStart, dayStart+24h)", async () => {
    const dayStart = new Date("2026-06-29T00:00:00.000Z");
    mocks.prisma.episode.count.mockResolvedValue(5);
    mocks.prisma.generatedOutput.count.mockResolvedValue(35);
    mocks.prisma.usageLog.aggregate.mockResolvedValue({ _sum: { costCents: 1234 } });
    mocks.prisma.invoice.aggregate.mockResolvedValue({ _sum: { amountCents: 9900 } });

    const totals = await rollupAgencyForDay({
      agencyId: "agc_1",
      plan: "AGENCY",
      dayStart,
    });

    expect(totals).toEqual({
      episodes: 5,
      outputs: 35,
      costCents: 1234,
      revenueCents: 9900,
    });

    // Verify each count call's date window — must be exactly 24h wide and
    // anchored to dayStart.
    const expectedDayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    for (const fn of [mocks.prisma.episode.count, mocks.prisma.generatedOutput.count]) {
      const where = fn.mock.calls[0]?.[0]?.where as { createdAt: { gte: Date; lt: Date } };
      expect(where.createdAt.gte).toEqual(dayStart);
      expect(where.createdAt.lt).toEqual(expectedDayEnd);
    }
  });

  it("scopes every count via the agency tenant chain (show.client.agencyId)", async () => {
    await rollupAgencyForDay({
      agencyId: "agc_xyz",
      plan: "STUDIO",
      dayStart: new Date("2026-06-29T00:00:00.000Z"),
    });
    const epWhere = mocks.prisma.episode.count.mock.calls[0]?.[0]?.where as {
      show: { client: { agencyId: string } };
    };
    expect(epWhere.show.client.agencyId).toBe("agc_xyz");
    const outWhere = mocks.prisma.generatedOutput.count.mock.calls[0]?.[0]?.where as {
      supersededAt: unknown;
      episode: { show: { client: { agencyId: string } } };
    };
    expect(outWhere.supersededAt).toBeNull();
    expect(outWhere.episode.show.client.agencyId).toBe("agc_xyz");
  });

  it("invoice aggregate filters status = PAID — drafts and voids don't count as revenue", async () => {
    await rollupAgencyForDay({
      agencyId: "agc_1",
      plan: "STUDIO",
      dayStart: new Date("2026-06-29T00:00:00.000Z"),
    });
    const invWhere = mocks.prisma.invoice.aggregate.mock.calls[0]?.[0]?.where as {
      status: string;
    };
    expect(invWhere.status).toBe("PAID");
  });

  it("upsert keys on (agencyId, date) so the same call is idempotent", async () => {
    const dayStart = new Date("2026-06-29T00:00:00.000Z");
    await rollupAgencyForDay({ agencyId: "agc_1", plan: "AGENCY", dayStart });

    const call = mocks.prisma.agencyUsageSnapshot.upsert.mock.calls[0]?.[0] as {
      where: { agencyId_date: { agencyId: string; date: Date } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(call.where.agencyId_date).toEqual({ agencyId: "agc_1", date: dayStart });
    // Create + update both carry the plan + totals so a re-run trues up
    // a stale snapshot if rows were back-dated.
    expect(call.create).toMatchObject({
      agencyId: "agc_1",
      date: dayStart,
      plan: "AGENCY",
      episodes: 0,
      outputs: 0,
      costCents: 0,
      revenueCents: 0,
    });
    expect(call.update).toMatchObject({
      plan: "AGENCY",
      episodes: 0,
      outputs: 0,
      costCents: 0,
      revenueCents: 0,
    });
  });

  it("null aggregate sums collapse to 0 on the row write (no NaNs)", async () => {
    mocks.prisma.usageLog.aggregate.mockResolvedValue({ _sum: { costCents: null } });
    mocks.prisma.invoice.aggregate.mockResolvedValue({ _sum: { amountCents: null } });

    const totals = await rollupAgencyForDay({
      agencyId: "agc_1",
      plan: "STUDIO",
      dayStart: new Date("2026-06-29T00:00:00.000Z"),
    });
    expect(totals.costCents).toBe(0);
    expect(totals.revenueCents).toBe(0);
  });
});
