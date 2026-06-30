/**
 * The system-agencies repo backs the ROOT-side `/root/agencies` surface — the
 * only cross-tenant read path in the codebase. These tests pin:
 *   - role gating (only the system roles get through, and every read role is
 *     accepted),
 *   - WHERE shape (search / plan / status / date-range layering),
 *   - end-of-day widening for the `createdTo` upper bound,
 *   - the NotFoundError surface when an id doesn't resolve.
 *
 * Aggregate-math correctness (episodesMtd / outputsMtd / costMtd) is the kind
 * of thing that wants an integration test against a real DB — the unit
 * surface here just asserts the WHERE shape per query.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, NotFoundError } from "@/server/auth/errors";

const mocks = vi.hoisted(() => ({
  prisma: {
    agency: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
    },
    episode: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    show: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    generatedOutput: {
      groupBy: vi.fn(),
      count: vi.fn(),
    },
    usageLog: {
      groupBy: vi.fn(),
      aggregate: vi.fn(),
    },
    outputTransition: {
      groupBy: vi.fn(),
      aggregate: vi.fn(),
    },
    invoice: {
      aggregate: vi.fn(),
    },
    systemAuditLog: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/server/db/client", () => ({ prisma: mocks.prisma }));

import type { SystemAdminContext } from "@/server/auth/system";
import {
  getAgencyForRoot,
  listAgenciesForRoot,
  listAgencyAuditEntries,
} from "@/server/db/system/agencies";

function ctxWith(role: SystemAdminContext["admin"]["role"]): SystemAdminContext {
  return {
    user: { clerkUserId: "user_test", email: "ops@example.com", name: null, imageUrl: null },
    admin: { id: "sa_1", role, mfaEnforced: true },
  };
}

beforeEach(() => {
  for (const table of Object.values(mocks.prisma)) {
    for (const fn of Object.values(table as Record<string, ReturnType<typeof vi.fn>>)) {
      fn.mockReset();
    }
  }
  // Sensible defaults for the aggregate calls so a happy-path test doesn't
  // have to stub every single one.
  mocks.prisma.agency.findMany.mockResolvedValue([]);
  mocks.prisma.agency.count.mockResolvedValue(0);
  mocks.prisma.episode.groupBy.mockResolvedValue([]);
  mocks.prisma.generatedOutput.groupBy.mockResolvedValue([]);
  mocks.prisma.usageLog.groupBy.mockResolvedValue([]);
  mocks.prisma.outputTransition.groupBy.mockResolvedValue([]);
  mocks.prisma.show.findMany.mockResolvedValue([]);
  mocks.prisma.episode.findMany.mockResolvedValue([]);
});

describe("listAgenciesForRoot", () => {
  it("rejects callers without a read-role bundle (no such role exists, but this is the floor case)", async () => {
    // Manufacture a context with an impossible role to confirm the gate fires
    // on anything outside SYSTEM_READ_ROLES. The cast is intentional — we're
    // testing the runtime guard, not the type.
    const ctx = { ...ctxWith("ROOT"), admin: { ...ctxWith("ROOT").admin, role: "GHOST" as never } };
    await expect(listAgenciesForRoot(ctx)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("every read role (ROOT, OPERATOR, SUPPORT, ANALYST) is accepted", async () => {
    for (const role of ["ROOT", "OPERATOR", "SUPPORT", "ANALYST"] as const) {
      const { rows, total } = await listAgenciesForRoot(ctxWith(role));
      expect(rows).toEqual([]);
      expect(total).toBe(0);
    }
    // Sanity: four invocations across four roles.
    expect(mocks.prisma.agency.findMany).toHaveBeenCalledTimes(4);
  });

  it("default WHERE is empty {} when no filters are passed", async () => {
    await listAgenciesForRoot(ctxWith("ROOT"));
    const call = mocks.prisma.agency.findMany.mock.calls[0]?.[0] as { where: unknown };
    expect(call.where).toEqual({});
  });

  it("search filters on case-insensitive substring of name", async () => {
    await listAgenciesForRoot(ctxWith("ROOT"), { search: "Acme" });
    const where = mocks.prisma.agency.findMany.mock.calls[0]?.[0] as { where: { name?: unknown } };
    expect(where.where.name).toEqual({ contains: "Acme", mode: "insensitive" });
  });

  it("plan filter is layered onto the where clause", async () => {
    await listAgenciesForRoot(ctxWith("ROOT"), { plan: "AGENCY" });
    const where = mocks.prisma.agency.findMany.mock.calls[0]?.[0] as { where: { plan?: unknown } };
    expect(where.where.plan).toBe("AGENCY");
  });

  it("status=active layers `suspendedAt: null`; status=suspended layers `{ not: null }`", async () => {
    await listAgenciesForRoot(ctxWith("ROOT"), { status: "active" });
    let where = mocks.prisma.agency.findMany.mock.calls[0]?.[0] as {
      where: { suspendedAt?: unknown };
    };
    expect(where.where.suspendedAt).toBeNull();

    mocks.prisma.agency.findMany.mockClear();
    await listAgenciesForRoot(ctxWith("ROOT"), { status: "suspended" });
    where = mocks.prisma.agency.findMany.mock.calls[0]?.[0] as {
      where: { suspendedAt?: unknown };
    };
    expect(where.where.suspendedAt).toEqual({ not: null });
  });

  it("createdFrom + createdTo build a date range with EOD widening on the upper bound", async () => {
    await listAgenciesForRoot(ctxWith("ROOT"), {
      createdFrom: new Date("2026-06-01T00:00:00.000Z"),
      createdTo: new Date("2026-06-30T00:00:00.000Z"),
    });
    const where = mocks.prisma.agency.findMany.mock.calls[0]?.[0] as {
      where: { createdAt?: { gte?: Date; lte?: Date } };
    };
    expect(where.where.createdAt?.gte).toEqual(new Date("2026-06-01T00:00:00.000Z"));
    const lte = where.where.createdAt?.lte;
    expect(lte).toBeInstanceOf(Date);
    // EOD widening pushes the hour to 23 + last ms of the day — confirm via
    // ms boundary rather than ISO string (timezone-sensitive).
    if (lte instanceof Date) {
      expect(lte.getHours()).toBe(23);
      expect(lte.getMinutes()).toBe(59);
      expect(lte.getMilliseconds()).toBe(999);
    }
  });

  it("rejects oversize `take` via Zod (max 100) before hitting the DB", async () => {
    await expect(
      // Zod throws on bad input — we never make it to findMany.
      listAgenciesForRoot(ctxWith("ROOT"), { take: 500 }),
    ).rejects.toThrow();
    expect(mocks.prisma.agency.findMany).not.toHaveBeenCalled();
  });

  it("returns total alongside rows so the page can paginate", async () => {
    mocks.prisma.agency.findMany.mockResolvedValue([
      {
        id: "agc_1",
        name: "Acme",
        plan: "STUDIO",
        createdAt: new Date(),
        members: [{ email: "owner@acme.com", name: "Owner" }],
        _count: { members: 3 },
      },
    ]);
    mocks.prisma.agency.count.mockResolvedValue(42);

    const result = await listAgenciesForRoot(ctxWith("ROOT"));
    expect(result.total).toBe(42);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      id: "agc_1",
      name: "Acme",
      plan: "STUDIO",
      ownerEmail: "owner@acme.com",
      memberCount: 3,
      episodesMtd: 0,
      outputsMtd: 0,
      costCentsMtd: 0,
    });
  });
});

describe("getAgencyForRoot", () => {
  it("throws NotFoundError when the id doesn't resolve", async () => {
    mocks.prisma.agency.findUnique.mockResolvedValue(null);
    await expect(getAgencyForRoot(ctxWith("ROOT"), "agc_missing")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("packages the drilldown payload from the per-aggregate queries", async () => {
    mocks.prisma.agency.findUnique.mockResolvedValue({
      id: "agc_1",
      name: "Acme",
      plan: "AGENCY",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-06-01"),
      clerkOrgId: null,
      stripeCustomerId: "cus_xxx",
      stripeSubscriptionId: "sub_xxx",
      preferredCurrency: "USD",
      brandLogoUrl: null,
      brandAccentColor: null,
      onboardingStep: "DONE",
      renewalRemindersEnabled: true,
      members: [{ id: "mem_1", email: "owner@acme.com", name: "Owner" }],
      _count: { members: 5, clients: 4, invoices: 7 },
    });
    mocks.prisma.show.count.mockResolvedValue(8);
    mocks.prisma.episode.count
      .mockResolvedValueOnce(120) // lifetime episodes
      .mockResolvedValueOnce(15); // episodes MTD
    mocks.prisma.generatedOutput.count
      .mockResolvedValueOnce(900) // current outputs lifetime
      .mockResolvedValueOnce(105); // outputs MTD
    mocks.prisma.usageLog.aggregate.mockResolvedValue({ _sum: { costCents: 12_300 } });
    mocks.prisma.invoice.aggregate.mockResolvedValue({ _sum: { amountCents: 24_900 } });
    mocks.prisma.outputTransition.aggregate.mockResolvedValue({
      _max: { createdAt: new Date("2026-06-30T10:00:00Z") },
    });

    const result = await getAgencyForRoot(ctxWith("ROOT"), "agc_1");

    expect(result.id).toBe("agc_1");
    expect(result.owner).toEqual({ id: "mem_1", email: "owner@acme.com", name: "Owner" });
    expect(result.totals).toEqual({
      members: 5,
      clients: 4,
      shows: 8,
      episodes: 120,
      outputs: 900,
      invoicesPaid: 7,
    });
    expect(result.monthToDate).toEqual({
      episodes: 15,
      outputs: 105,
      costCents: 12_300,
      revenueCents: 24_900,
    });
    expect(result.lastActivityAt?.toISOString()).toBe("2026-06-30T10:00:00.000Z");
  });

  it("collapses null `_sum.costCents` to 0 so the UI can format without a guard", async () => {
    mocks.prisma.agency.findUnique.mockResolvedValue({
      id: "agc_2",
      name: "Empty",
      plan: "STUDIO",
      createdAt: new Date(),
      updatedAt: new Date(),
      clerkOrgId: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      preferredCurrency: "USD",
      brandLogoUrl: null,
      brandAccentColor: null,
      onboardingStep: "DONE",
      renewalRemindersEnabled: true,
      members: [],
      _count: { members: 0, clients: 0, invoices: 0 },
    });
    mocks.prisma.show.count.mockResolvedValue(0);
    mocks.prisma.episode.count.mockResolvedValue(0);
    mocks.prisma.generatedOutput.count.mockResolvedValue(0);
    mocks.prisma.usageLog.aggregate.mockResolvedValue({ _sum: { costCents: null } });
    mocks.prisma.invoice.aggregate.mockResolvedValue({ _sum: { amountCents: null } });
    mocks.prisma.outputTransition.aggregate.mockResolvedValue({ _max: { createdAt: null } });

    const result = await getAgencyForRoot(ctxWith("ROOT"), "agc_2");
    expect(result.monthToDate.costCents).toBe(0);
    expect(result.monthToDate.revenueCents).toBe(0);
    expect(result.lastActivityAt).toBeNull();
    expect(result.owner).toBeNull();
  });

  it("rejects callers without a read-role bundle", async () => {
    const ctx = { ...ctxWith("ROOT"), admin: { ...ctxWith("ROOT").admin, role: "GHOST" as never } };
    await expect(getAgencyForRoot(ctx, "agc_1")).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.prisma.agency.findUnique).not.toHaveBeenCalled();
  });
});

describe("listAgencyAuditEntries", () => {
  it("filters by targetAgencyId and respects the limit (cap at 50)", async () => {
    mocks.prisma.systemAuditLog.findMany.mockResolvedValue([]);
    await listAgencyAuditEntries(ctxWith("ROOT"), "agc_1", 1000);

    const call = mocks.prisma.systemAuditLog.findMany.mock.calls[0]?.[0] as {
      where: { targetAgencyId: string };
      take: number;
      orderBy: unknown;
    };
    expect(call.where).toEqual({ targetAgencyId: "agc_1" });
    expect(call.take).toBe(50);
    expect(call.orderBy).toEqual({ createdAt: "desc" });
  });

  it("maps the actor relation onto a flat shape so the UI doesn't re-traverse", async () => {
    mocks.prisma.systemAuditLog.findMany.mockResolvedValue([
      {
        id: "sl_1",
        action: "agency.suspend",
        note: "Spam",
        createdAt: new Date("2026-06-30T10:00:00Z"),
        bySystemAdmin: { email: "ops@example.com", name: "Ops" },
      },
    ]);
    const rows = await listAgencyAuditEntries(ctxWith("ROOT"), "agc_1");
    expect(rows[0]).toEqual({
      id: "sl_1",
      action: "agency.suspend",
      note: "Spam",
      createdAt: new Date("2026-06-30T10:00:00Z"),
      actor: { email: "ops@example.com", name: "Ops" },
    });
  });
});
