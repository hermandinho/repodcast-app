/**
 * Plan-limit enforcement (Phase 1.11). Verifies that:
 *
 *  - `planCapacity` queries the correct table + tenant-anchored where clause
 *    for each LimitedResource (the cap-meter UI and the soft banner both
 *    derive from this — a typo in the where would either over-report usage
 *    or leak cross-tenant counts).
 *  - `assertPlanCapacity` throws ForbiddenError at-or-over the cap and stays
 *    silent below it. The thrown message carries the plan / resource /
 *    limit / current-used numbers so the surfaced toast is actionable.
 *  - `getAgencyPlan` throws when the agency row is missing.
 *  - `loadCapacityForUI` bundles plan + resource into the shape the banner
 *    expects.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Plan } from "@prisma/client";
import { ForbiddenError } from "@/server/auth/errors";

const mocks = vi.hoisted(() => ({
  prisma: {
    agency: { findUnique: vi.fn() },
    show: { count: vi.fn() },
    member: { count: vi.fn() },
    episode: { count: vi.fn() },
    generatedOutput: { count: vi.fn() },
  },
}));

vi.mock("@/server/db/client", () => ({ prisma: mocks.prisma }));

import {
  assertMinPlan,
  assertPlanCapacity,
  getAgencyPlan,
  loadCapacityForUI,
  planCapacity,
} from "@/server/billing/limits";
import { planLimitsFor } from "@/lib/plans";

const A1 = "agency_a1";

beforeEach(() => {
  for (const model of Object.values(mocks.prisma)) {
    for (const fn of Object.values(model)) {
      if (typeof fn === "function" && "mockReset" in fn) {
        (fn as { mockReset: () => void }).mockReset();
      }
    }
  }
});

// ============================================================
// planCapacity — per-resource shape + tenant filter
// ============================================================

describe("planCapacity — shows", () => {
  it("counts via Show with the nested client.agencyId filter", async () => {
    mocks.prisma.show.count.mockResolvedValue(2);
    const result = await planCapacity(A1, Plan.STUDIO, "shows");
    expect(mocks.prisma.show.count).toHaveBeenCalledWith({
      where: { client: { agencyId: A1 } },
    });
    expect(result).toEqual({ used: 2, limit: planLimitsFor(Plan.STUDIO).shows });
  });
});

describe("planCapacity — members", () => {
  it("counts via Member directly, anchored to agencyId", async () => {
    mocks.prisma.member.count.mockResolvedValue(5);
    const result = await planCapacity(A1, Plan.AGENCY, "members");
    expect(mocks.prisma.member.count).toHaveBeenCalledWith({
      where: { agencyId: A1 },
    });
    expect(result).toEqual({ used: 5, limit: planLimitsFor(Plan.AGENCY).seats });
  });
});

describe("planCapacity — episodes (per-month)", () => {
  it("filters by createdAt >= month-start AND the nested tenant join", async () => {
    mocks.prisma.episode.count.mockResolvedValue(14);
    const result = await planCapacity(A1, Plan.AGENCY, "episodes");

    const call = mocks.prisma.episode.count.mock.calls[0]![0];
    expect(call.where.show).toEqual({ client: { agencyId: A1 } });
    expect(call.where.createdAt.gte).toBeInstanceOf(Date);
    // Window starts at midnight local time on day 1 of the current month.
    const gte = call.where.createdAt.gte as Date;
    expect(gte.getDate()).toBe(1);
    expect(gte.getHours()).toBe(0);
    expect(gte.getMinutes()).toBe(0);

    expect(result).toEqual({
      used: 14,
      limit: planLimitsFor(Plan.AGENCY).episodesPerMonth,
    });
  });
});

describe("planCapacity — generations (per-month)", () => {
  it("filters via the double-nested episode.show.client.agencyId join", async () => {
    mocks.prisma.generatedOutput.count.mockResolvedValue(98);
    const result = await planCapacity(A1, Plan.STUDIO, "generations");

    const call = mocks.prisma.generatedOutput.count.mock.calls[0]![0];
    expect(call.where.episode).toEqual({
      show: { client: { agencyId: A1 } },
    });
    expect(call.where.createdAt.gte).toBeInstanceOf(Date);

    expect(result).toEqual({
      used: 98,
      limit: planLimitsFor(Plan.STUDIO).generationsPerMonth,
    });
  });
});

// ============================================================
// assertPlanCapacity — gate behavior
// ============================================================

describe("assertPlanCapacity", () => {
  it("passes silently when used < limit", async () => {
    mocks.prisma.show.count.mockResolvedValue(1);
    await expect(assertPlanCapacity(A1, Plan.STUDIO, "shows")).resolves.toBeUndefined();
  });

  it("throws ForbiddenError when used === limit (at-cap)", async () => {
    mocks.prisma.show.count.mockResolvedValue(planLimitsFor(Plan.STUDIO).shows);
    await expect(assertPlanCapacity(A1, Plan.STUDIO, "shows")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws ForbiddenError when used > limit (over-cap — race losers)", async () => {
    const overCap = planLimitsFor(Plan.STUDIO).shows + 3;
    mocks.prisma.show.count.mockResolvedValue(overCap);
    await expect(assertPlanCapacity(A1, Plan.STUDIO, "shows")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("error message carries plan + resource + limit + used for the UI toast", async () => {
    mocks.prisma.member.count.mockResolvedValue(2);
    try {
      await assertPlanCapacity(A1, Plan.STUDIO, "members");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      const message = (err as ForbiddenError).message;
      expect(message).toContain("STUDIO");
      expect(message).toContain("members");
      expect(message).toContain("2");
      expect(message).toMatch(/Upgrade/);
    }
  });
});

// ============================================================
// getAgencyPlan — single-query plan lookup
// ============================================================

describe("getAgencyPlan", () => {
  it("returns the agency's plan when the row exists", async () => {
    mocks.prisma.agency.findUnique.mockResolvedValue({ plan: Plan.AGENCY });
    await expect(getAgencyPlan(A1)).resolves.toBe(Plan.AGENCY);
    expect(mocks.prisma.agency.findUnique).toHaveBeenCalledWith({
      where: { id: A1 },
      select: { plan: true },
    });
  });

  it("throws ForbiddenError when the agency row is missing", async () => {
    mocks.prisma.agency.findUnique.mockResolvedValue(null);
    await expect(getAgencyPlan(A1)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ============================================================
// loadCapacityForUI — banner-ready bundle
// ============================================================

describe("loadCapacityForUI", () => {
  it("bundles plan + resource alongside used + limit for the banner", async () => {
    mocks.prisma.agency.findUnique.mockResolvedValue({ plan: Plan.AGENCY });
    mocks.prisma.show.count.mockResolvedValue(7);

    const result = await loadCapacityForUI(A1, "shows");
    expect(result).toEqual({
      used: 7,
      limit: planLimitsFor(Plan.AGENCY).shows,
      plan: Plan.AGENCY,
      resource: "shows",
    });
  });
});

// ============================================================
// assertMinPlan — per-feature plan gates
// ============================================================

describe("assertMinPlan", () => {
  it("passes when the caller's plan matches the minimum", () => {
    expect(() => assertMinPlan(Plan.STUDIO, Plan.STUDIO)).not.toThrow();
    expect(() => assertMinPlan(Plan.AGENCY, Plan.AGENCY)).not.toThrow();
    expect(() => assertMinPlan(Plan.NETWORK, Plan.NETWORK)).not.toThrow();
  });

  it("passes when the caller's plan is above the minimum", () => {
    expect(() => assertMinPlan(Plan.AGENCY, Plan.STUDIO)).not.toThrow();
    expect(() => assertMinPlan(Plan.NETWORK, Plan.STUDIO)).not.toThrow();
    expect(() => assertMinPlan(Plan.NETWORK, Plan.AGENCY)).not.toThrow();
  });

  it("throws ForbiddenError when the caller's plan is below the minimum", () => {
    expect(() => assertMinPlan(Plan.STUDIO, Plan.AGENCY)).toThrow(ForbiddenError);
    expect(() => assertMinPlan(Plan.STUDIO, Plan.NETWORK)).toThrow(ForbiddenError);
    expect(() => assertMinPlan(Plan.AGENCY, Plan.NETWORK)).toThrow(ForbiddenError);
  });

  it("message names the required plan so callers can surface an upgrade CTA", () => {
    try {
      assertMinPlan(Plan.STUDIO, Plan.AGENCY);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      const fe = err as ForbiddenError;
      expect(fe.statusCode).toBe(403);
      expect(fe.message).toContain("STUDIO");
      expect(fe.message).toContain("AGENCY");
    }
  });

  it("full 3×3 rank matrix matches the marketing tier order", () => {
    // Studio(0) < Agency(1) < Network(2). Encoded once as truth table so
    // a future flip in `PLAN_RANK` inside limits.ts trips this instead of
    // silently reversing gate direction.
    const cases: Array<{ caller: Plan; minimum: Plan; allowed: boolean }> = [
      { caller: Plan.STUDIO, minimum: Plan.STUDIO, allowed: true },
      { caller: Plan.STUDIO, minimum: Plan.AGENCY, allowed: false },
      { caller: Plan.STUDIO, minimum: Plan.NETWORK, allowed: false },
      { caller: Plan.AGENCY, minimum: Plan.STUDIO, allowed: true },
      { caller: Plan.AGENCY, minimum: Plan.AGENCY, allowed: true },
      { caller: Plan.AGENCY, minimum: Plan.NETWORK, allowed: false },
      { caller: Plan.NETWORK, minimum: Plan.STUDIO, allowed: true },
      { caller: Plan.NETWORK, minimum: Plan.AGENCY, allowed: true },
      { caller: Plan.NETWORK, minimum: Plan.NETWORK, allowed: true },
    ];
    for (const { caller, minimum, allowed } of cases) {
      if (allowed) {
        expect(() => assertMinPlan(caller, minimum)).not.toThrow();
      } else {
        expect(() => assertMinPlan(caller, minimum)).toThrow(ForbiddenError);
      }
    }
  });
});
