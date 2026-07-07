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
    /**
     * Phase 3.6.11 wired `planCapacity` through `getEffectiveLimitOverride`,
     * which reads from this table. Default mock resolves to `null` (no
     * override) so every pre-existing test stays green — the tests below
     * override this to exercise the override path explicitly.
     */
    agencyLimitOverride: { findUnique: vi.fn() },
  },
}));

vi.mock("@/server/db/client", () => ({ prisma: mocks.prisma }));

import {
  assertMinPlan,
  assertPlanCapacity,
  getAgencyPlan,
  hasActiveAccess,
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
  // Default: no override — every legacy planCapacity assertion assumes the
  // plan default takes hold. The override tests reset this per-case.
  mocks.prisma.agencyLimitOverride.findUnique.mockResolvedValue(null);
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
    const result = await planCapacity(A1, Plan.NETWORK, "members");
    expect(mocks.prisma.member.count).toHaveBeenCalledWith({
      where: { agencyId: A1 },
    });
    expect(result).toEqual({ used: 5, limit: planLimitsFor(Plan.NETWORK).seats });
  });
});

describe("planCapacity — episodes (per-month)", () => {
  it("filters by createdAt >= month-start AND the nested tenant join", async () => {
    mocks.prisma.episode.count.mockResolvedValue(14);
    const result = await planCapacity(A1, Plan.NETWORK, "episodes");

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
      limit: planLimitsFor(Plan.NETWORK).episodesPerMonth,
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
      await assertPlanCapacity(A1, Plan.SOLO, "members");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      const message = (err as ForbiddenError).message;
      expect(message).toContain("SOLO");
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
  it("returns the base plan when no override is set", async () => {
    mocks.prisma.agency.findUnique.mockResolvedValue({
      plan: Plan.NETWORK,
      planOverride: null,
    });
    await expect(getAgencyPlan(A1)).resolves.toBe(Plan.NETWORK);
    expect(mocks.prisma.agency.findUnique).toHaveBeenCalledWith({
      where: { id: A1 },
      select: { plan: true, planOverride: true },
    });
  });

  it("prefers planOverride when set (comp / support-escalation grant)", async () => {
    // Paid tier is STUDIO, override bumps to NETWORK — hot path for a
    // partner comp account.
    mocks.prisma.agency.findUnique.mockResolvedValue({
      plan: Plan.STUDIO,
      planOverride: Plan.NETWORK,
    });
    await expect(getAgencyPlan(A1)).resolves.toBe(Plan.NETWORK);
  });

  it("also honours a *downward* override (throttle an abusing account)", async () => {
    // Paid tier is NETWORK, override caps at STUDIO — the override is
    // absolute, not "max of override/plan".
    mocks.prisma.agency.findUnique.mockResolvedValue({
      plan: Plan.NETWORK,
      planOverride: Plan.STUDIO,
    });
    await expect(getAgencyPlan(A1)).resolves.toBe(Plan.STUDIO);
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
    mocks.prisma.agency.findUnique.mockResolvedValue({ plan: Plan.NETWORK });
    mocks.prisma.show.count.mockResolvedValue(7);

    const result = await loadCapacityForUI(A1, "shows");
    expect(result).toEqual({
      used: 7,
      limit: planLimitsFor(Plan.NETWORK).shows,
      plan: Plan.NETWORK,
      resource: "shows",
    });
  });
});

// ============================================================
// assertMinPlan — per-feature plan gates
// ============================================================

describe("assertMinPlan", () => {
  it("passes when the caller's plan matches the minimum", () => {
    expect(() => assertMinPlan(Plan.SOLO, Plan.SOLO)).not.toThrow();
    expect(() => assertMinPlan(Plan.STUDIO, Plan.STUDIO)).not.toThrow();
    expect(() => assertMinPlan(Plan.NETWORK, Plan.NETWORK)).not.toThrow();
  });

  it("passes when the caller's plan is above the minimum", () => {
    expect(() => assertMinPlan(Plan.STUDIO, Plan.SOLO)).not.toThrow();
    expect(() => assertMinPlan(Plan.NETWORK, Plan.SOLO)).not.toThrow();
    expect(() => assertMinPlan(Plan.NETWORK, Plan.STUDIO)).not.toThrow();
  });

  it("throws ForbiddenError when the caller's plan is below the minimum", () => {
    expect(() => assertMinPlan(Plan.SOLO, Plan.STUDIO)).toThrow(ForbiddenError);
    expect(() => assertMinPlan(Plan.SOLO, Plan.NETWORK)).toThrow(ForbiddenError);
    expect(() => assertMinPlan(Plan.STUDIO, Plan.NETWORK)).toThrow(ForbiddenError);
  });

  it("message names the required plan so callers can surface an upgrade CTA", () => {
    try {
      assertMinPlan(Plan.SOLO, Plan.NETWORK);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      const fe = err as ForbiddenError;
      expect(fe.statusCode).toBe(403);
      expect(fe.message).toContain("SOLO");
      expect(fe.message).toContain("NETWORK");
    }
  });

  it("full 3×3 rank matrix matches the marketing tier order", () => {
    // Solo(0) < Studio(1) < Network(2). Encoded once as truth table so
    // a future flip in `PLAN_RANK` inside limits.ts trips this instead of
    // silently reversing gate direction.
    const cases: Array<{ caller: Plan; minimum: Plan; allowed: boolean }> = [
      { caller: Plan.SOLO, minimum: Plan.SOLO, allowed: true },
      { caller: Plan.SOLO, minimum: Plan.STUDIO, allowed: false },
      { caller: Plan.SOLO, minimum: Plan.NETWORK, allowed: false },
      { caller: Plan.STUDIO, minimum: Plan.SOLO, allowed: true },
      { caller: Plan.STUDIO, minimum: Plan.STUDIO, allowed: true },
      { caller: Plan.STUDIO, minimum: Plan.NETWORK, allowed: false },
      { caller: Plan.NETWORK, minimum: Plan.SOLO, allowed: true },
      { caller: Plan.NETWORK, minimum: Plan.STUDIO, allowed: true },
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

// ============================================================
// planCapacity — AgencyLimitOverride consumption (Phase 3.6.11)
// ============================================================
//
// The override replaces the plan default absolutely — an override of 5 on a
// STUDIO account with the default `shows: 5` means the effective cap is 5,
// not 5+5. An override of 1 on the same account is a HARD CAP: the operator
// can throttle an abusing agency below its plan tier.

describe("planCapacity — override consumption", () => {
  it("uses the override value in place of the plan default when active", async () => {
    mocks.prisma.show.count.mockResolvedValue(2);
    mocks.prisma.agencyLimitOverride.findUnique.mockResolvedValue({
      value: 10,
      expiresAt: null,
    });

    const result = await planCapacity(A1, Plan.STUDIO, "shows");
    expect(result).toEqual({ used: 2, limit: 10 });
    // Prisma is looked up by the composite unique — confirm the enum is
    // mapped from the lowercase resource union.
    expect(mocks.prisma.agencyLimitOverride.findUnique).toHaveBeenCalledWith({
      where: { agencyId_resource: { agencyId: A1, resource: "SHOWS" } },
      select: { value: true, expiresAt: true },
    });
  });

  it("ignores an override whose expiresAt has passed", async () => {
    mocks.prisma.member.count.mockResolvedValue(4);
    // Expired one hour ago.
    mocks.prisma.agencyLimitOverride.findUnique.mockResolvedValue({
      value: 999,
      expiresAt: new Date(Date.now() - 60 * 60 * 1000),
    });

    const result = await planCapacity(A1, Plan.NETWORK, "members");
    expect(result.limit).toBe(planLimitsFor(Plan.NETWORK).seats);
    expect(result.used).toBe(4);
  });

  it("honours a future expiresAt (still in effect)", async () => {
    mocks.prisma.episode.count.mockResolvedValue(1);
    mocks.prisma.agencyLimitOverride.findUnique.mockResolvedValue({
      value: 500,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const result = await planCapacity(A1, Plan.STUDIO, "episodes");
    expect(result.limit).toBe(500);
  });

  it("respects an override of `0` (fully cap the resource)", async () => {
    mocks.prisma.generatedOutput.count.mockResolvedValue(0);
    mocks.prisma.agencyLimitOverride.findUnique.mockResolvedValue({
      value: 0,
      expiresAt: null,
    });

    const result = await planCapacity(A1, Plan.NETWORK, "generations");
    expect(result.limit).toBe(0);
    // assertPlanCapacity would fire ForbiddenError on any usage against this
    // cap — which is exactly the abuse-throttle path the override enables.
  });
});

// ============================================================
// hasActiveAccess — shared predicate for the "paid access" gates
// ============================================================

describe("hasActiveAccess", () => {
  it("returns true when a Stripe subscription is live (no comp needed)", () => {
    expect(
      hasActiveAccess({
        stripeSubscriptionId: "sub_123",
        compAccessExpiresAt: null,
      }),
    ).toBe(true);
  });

  it("returns true when comp window is in the future — no Stripe sub required", () => {
    expect(
      hasActiveAccess({
        stripeSubscriptionId: null,
        compAccessExpiresAt: new Date(Date.now() + 60 * 1000),
      }),
    ).toBe(true);
  });

  it("returns false when comp window has expired", () => {
    expect(
      hasActiveAccess({
        stripeSubscriptionId: null,
        compAccessExpiresAt: new Date(Date.now() - 60 * 1000),
      }),
    ).toBe(false);
  });

  it("returns false when both signals are absent (post-cancel, no comp)", () => {
    expect(
      hasActiveAccess({
        stripeSubscriptionId: null,
        compAccessExpiresAt: null,
      }),
    ).toBe(false);
  });

  it("Stripe sub trumps an expired comp — canceled+comp customer stays inside the app", () => {
    // Should never happen in practice (revokeAgencyCompAccess nulls the
    // field), but the predicate is defensive: EITHER signal is sufficient.
    expect(
      hasActiveAccess({
        stripeSubscriptionId: "sub_123",
        compAccessExpiresAt: new Date(Date.now() - 60 * 1000),
      }),
    ).toBe(true);
  });
});
