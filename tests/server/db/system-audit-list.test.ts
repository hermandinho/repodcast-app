/**
 * `/root/audit` viewer repo helpers.
 *
 * Pins the load-bearing surface of `listSystemAuditEntries` +
 * `listActiveSystemAdmins`:
 *   - role gate rejects non-read roles
 *   - where-clause shape for each filter axis (admin, action, agencyId,
 *     agency name search, date range)
 *   - end-of-day widening on `createdTo`
 *   - agency-name search resolves matching agencyIds first and short-
 *     circuits to an empty result when no agencies match
 *   - row-level agency name enrichment via a second query so hard-deleted
 *     agencies don't drop their audit history
 *   - active-admin dropdown ordered by role rank then email
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemAdminRole } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  systemAuditLogFindMany: vi.fn(),
  systemAuditLogCount: vi.fn(),
  agencyFindMany: vi.fn(),
  systemAdminFindMany: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    systemAuditLog: {
      findMany: mocks.systemAuditLogFindMany,
      count: mocks.systemAuditLogCount,
    },
    agency: {
      findMany: mocks.agencyFindMany,
    },
    systemAdmin: {
      findMany: mocks.systemAdminFindMany,
    },
  },
}));

import { ForbiddenError } from "@/server/auth/errors";
import type { SystemAdminContext } from "@/server/auth/system";
import {
  listActiveSystemAdmins,
  listSystemAuditEntries,
  SYSTEM_AUDIT_ACTION_OPTIONS,
} from "@/server/db/system/audit";

function ctx(role: SystemAdminRole = "ROOT"): SystemAdminContext {
  return {
    user: { clerkUserId: "user_1", email: "ops@example.com", name: null, imageUrl: null },
    admin: { id: "sa_1", role, mfaEnforced: true },
  };
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.systemAuditLogFindMany.mockResolvedValue([]);
  mocks.systemAuditLogCount.mockResolvedValue(0);
  mocks.agencyFindMany.mockResolvedValue([]);
  mocks.systemAdminFindMany.mockResolvedValue([]);
});

// ============================================================
// Role gate
// ============================================================

describe("listSystemAuditEntries — role gate", () => {
  it("rejects a role that isn't in SYSTEM_READ_ROLES", async () => {
    const bad = { ...ctx(), admin: { ...ctx().admin, role: "UNKNOWN" as never } };
    await expect(listSystemAuditEntries(bad)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it.each(["ROOT", "OPERATOR", "SUPPORT", "ANALYST"] satisfies SystemAdminRole[])(
    "%s can read the audit log",
    async (role) => {
      await expect(listSystemAuditEntries(ctx(role))).resolves.toEqual({ rows: [], total: 0 });
    },
  );
});

// ============================================================
// Filter shape
// ============================================================

describe("listSystemAuditEntries — filter shape", () => {
  it("defaults take=25 / skip=0 when omitted", async () => {
    await listSystemAuditEntries(ctx(), {});
    const findArgs = mocks.systemAuditLogFindMany.mock.calls[0]?.[0] as {
      take: number;
      skip: number;
    };
    expect(findArgs.take).toBe(25);
    expect(findArgs.skip).toBe(0);
  });

  it("filters by bySystemAdminId when set", async () => {
    await listSystemAuditEntries(ctx(), { bySystemAdminId: "sa_admin_x" });
    const findArgs = mocks.systemAuditLogFindMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(findArgs.where.bySystemAdminId).toBe("sa_admin_x");
  });

  it("filters by action when set to a known key", async () => {
    await listSystemAuditEntries(ctx(), { action: "agency.suspend" });
    const findArgs = mocks.systemAuditLogFindMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(findArgs.where.action).toBe("agency.suspend");
  });

  it("filters by targetAgencyId directly (no agency lookup needed)", async () => {
    await listSystemAuditEntries(ctx(), { targetAgencyId: "agc_123" });
    const findArgs = mocks.systemAuditLogFindMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(findArgs.where.targetAgencyId).toBe("agc_123");
    // Agency lookup should NOT have fired — the direct id needs no name resolution.
    // (mock.calls covers both the search resolve AND the enrichment step; without
    // agencySearch the only call would be the enrichment, which only fires when
    // rows come back — and here rows is [].)
    expect(mocks.agencyFindMany).not.toHaveBeenCalled();
  });

  it("widens createdTo to end-of-day and passes createdFrom verbatim", async () => {
    await listSystemAuditEntries(ctx(), {
      createdFrom: "2026-01-01",
      createdTo: "2026-03-31",
    });
    const findArgs = mocks.systemAuditLogFindMany.mock.calls[0]?.[0] as {
      where: { createdAt: { gte: Date; lte: Date } };
    };
    expect(findArgs.where.createdAt.gte).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    // 23:59:59.999 UTC on the same day
    expect(findArgs.where.createdAt.lte.toISOString()).toBe("2026-03-31T23:59:59.999Z");
  });

  it("resolves agencySearch to matching agency ids and filters via `in`", async () => {
    mocks.agencyFindMany.mockResolvedValueOnce([{ id: "agc_1" }, { id: "agc_2" }]);
    await listSystemAuditEntries(ctx(), { agencySearch: "Acme" });

    // First call is the id-resolution query.
    const agencyLookup = mocks.agencyFindMany.mock.calls[0]?.[0] as {
      where: { name: { contains: string; mode: string } };
      select: { id: boolean };
    };
    expect(agencyLookup.where).toEqual({ name: { contains: "Acme", mode: "insensitive" } });

    const findArgs = mocks.systemAuditLogFindMany.mock.calls[0]?.[0] as {
      where: { targetAgencyId: { in: string[] } };
    };
    expect(findArgs.where.targetAgencyId).toEqual({ in: ["agc_1", "agc_2"] });
  });

  it("collapses to a scalar targetAgencyId when agencySearch matches exactly one", async () => {
    mocks.agencyFindMany.mockResolvedValueOnce([{ id: "agc_only" }]);
    await listSystemAuditEntries(ctx(), { agencySearch: "Only" });
    const findArgs = mocks.systemAuditLogFindMany.mock.calls[0]?.[0] as {
      where: { targetAgencyId: string };
    };
    expect(findArgs.where.targetAgencyId).toBe("agc_only");
  });

  it("short-circuits to zero rows when agencySearch matches no agencies", async () => {
    mocks.agencyFindMany.mockResolvedValueOnce([]);

    const result = await listSystemAuditEntries(ctx(), { agencySearch: "NoSuchAgency" });

    expect(result).toEqual({ rows: [], total: 0 });
    // The audit query must NOT have run — we short-circuit before spending
    // that query budget.
    expect(mocks.systemAuditLogFindMany).not.toHaveBeenCalled();
    expect(mocks.systemAuditLogCount).not.toHaveBeenCalled();
  });

  it("intersects targetAgencyId + agencySearch when both are set", async () => {
    // Direct id is "agc_1", name search matches [agc_2, agc_3] → intersection is empty.
    mocks.agencyFindMany.mockResolvedValueOnce([{ id: "agc_2" }, { id: "agc_3" }]);
    const result = await listSystemAuditEntries(ctx(), {
      targetAgencyId: "agc_1",
      agencySearch: "Other",
    });
    expect(result).toEqual({ rows: [], total: 0 });
    expect(mocks.systemAuditLogFindMany).not.toHaveBeenCalled();
  });

  it("orders by createdAt DESC (matches the DB index)", async () => {
    await listSystemAuditEntries(ctx(), {});
    const findArgs = mocks.systemAuditLogFindMany.mock.calls[0]?.[0] as {
      orderBy: { createdAt: string };
    };
    expect(findArgs.orderBy).toEqual({ createdAt: "desc" });
  });
});

// ============================================================
// Row enrichment
// ============================================================

describe("listSystemAuditEntries — row enrichment", () => {
  it("enriches rows with the target agency name via a batched second query", async () => {
    mocks.systemAuditLogFindMany.mockResolvedValueOnce([
      buildRawRow({ id: "au_1", targetAgencyId: "agc_a" }),
      buildRawRow({ id: "au_2", targetAgencyId: "agc_b" }),
      // A second row for agc_a — the enrichment should NOT double-query.
      buildRawRow({ id: "au_3", targetAgencyId: "agc_a" }),
    ]);
    mocks.systemAuditLogCount.mockResolvedValueOnce(3);
    mocks.agencyFindMany.mockResolvedValueOnce([
      { id: "agc_a", name: "Acme" },
      { id: "agc_b", name: "Beta" },
    ]);

    const { rows } = await listSystemAuditEntries(ctx(), {});

    // Only one agency lookup (the enrichment step) — the where has no
    // agencySearch so the search-side lookup is skipped.
    expect(mocks.agencyFindMany).toHaveBeenCalledTimes(1);
    const enrichArgs = mocks.agencyFindMany.mock.calls[0]?.[0] as {
      where: { id: { in: string[] } };
    };
    // Distinct ids only — no dupes.
    expect(enrichArgs.where.id.in.sort()).toEqual(["agc_a", "agc_b"]);

    expect(rows[0].targetAgency).toEqual({ id: "agc_a", name: "Acme" });
    expect(rows[1].targetAgency).toEqual({ id: "agc_b", name: "Beta" });
    expect(rows[2].targetAgency).toEqual({ id: "agc_a", name: "Acme" });
  });

  it("returns an empty-string name when the referenced agency was hard-deleted", async () => {
    mocks.systemAuditLogFindMany.mockResolvedValueOnce([
      buildRawRow({ id: "au_1", targetAgencyId: "agc_gone" }),
    ]);
    mocks.systemAuditLogCount.mockResolvedValueOnce(1);
    // Enrichment returns no row — the agency was deleted.
    mocks.agencyFindMany.mockResolvedValueOnce([]);

    const { rows } = await listSystemAuditEntries(ctx(), {});
    expect(rows[0].targetAgency).toEqual({ id: "agc_gone", name: "" });
  });

  it("leaves targetAgency null when the audit row had no targetAgencyId", async () => {
    mocks.systemAuditLogFindMany.mockResolvedValueOnce([
      buildRawRow({ id: "au_1", targetAgencyId: null }),
    ]);
    mocks.systemAuditLogCount.mockResolvedValueOnce(1);

    const { rows } = await listSystemAuditEntries(ctx(), {});
    expect(rows[0].targetAgency).toBeNull();
    // No enrichment query when there are no agency ids to resolve.
    expect(mocks.agencyFindMany).not.toHaveBeenCalled();
  });

  it("normalizes null-JSON snapshots to `null` on the row shape", async () => {
    mocks.systemAuditLogFindMany.mockResolvedValueOnce([
      buildRawRow({ id: "au_1", before: null, after: null }),
    ]);
    mocks.systemAuditLogCount.mockResolvedValueOnce(1);

    const { rows } = await listSystemAuditEntries(ctx(), {});
    expect(rows[0].before).toBeNull();
    expect(rows[0].after).toBeNull();
  });
});

// ============================================================
// listActiveSystemAdmins
// ============================================================

describe("listActiveSystemAdmins", () => {
  it("filters to non-deactivated rows and sorts by role rank then email", async () => {
    mocks.systemAdminFindMany.mockResolvedValueOnce([
      { id: "sa_c", email: "c@x.io", name: null, role: "SUPPORT" satisfies SystemAdminRole },
      { id: "sa_a", email: "a@x.io", name: null, role: "ROOT" satisfies SystemAdminRole },
      { id: "sa_b", email: "b@x.io", name: null, role: "ROOT" satisfies SystemAdminRole },
      { id: "sa_d", email: "d@x.io", name: null, role: "OPERATOR" satisfies SystemAdminRole },
    ]);

    const admins = await listActiveSystemAdmins(ctx());

    const findArgs = mocks.systemAdminFindMany.mock.calls[0]?.[0] as {
      where: { deactivatedAt: null };
    };
    expect(findArgs.where.deactivatedAt).toBeNull();

    // ROOT (a, b) → OPERATOR (d) → SUPPORT (c). Within a role, ascending email.
    expect(admins.map((a) => a.id)).toEqual(["sa_a", "sa_b", "sa_d", "sa_c"]);
  });

  it("throws ForbiddenError on a bad role", async () => {
    const bad = { ...ctx(), admin: { ...ctx().admin, role: "UNKNOWN" as never } };
    await expect(listActiveSystemAdmins(bad)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ============================================================
// SYSTEM_AUDIT_ACTION_OPTIONS export
// ============================================================

describe("SYSTEM_AUDIT_ACTION_OPTIONS", () => {
  it("exposes the full action set for the filter dropdown", () => {
    expect(SYSTEM_AUDIT_ACTION_OPTIONS).toContain("agency.suspend");
    expect(SYSTEM_AUDIT_ACTION_OPTIONS).toContain("impersonate.start");
    expect(SYSTEM_AUDIT_ACTION_OPTIONS).toContain("config.update");
    // Sanity — the union type is bounded by the const map; length should
    // match the number of dotted-key entries.
    expect(SYSTEM_AUDIT_ACTION_OPTIONS.length).toBeGreaterThanOrEqual(20);
  });
});

// ============================================================
// Fixtures
// ============================================================

function buildRawRow(overrides: {
  id: string;
  action?: string;
  targetAgencyId?: string | null;
  targetMemberId?: string | null;
  targetEntityType?: string | null;
  targetEntityId?: string | null;
  before?: unknown;
  after?: unknown;
  note?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt?: Date;
  admin?: { id: string; email: string; name: string | null; role: SystemAdminRole };
}) {
  return {
    id: overrides.id,
    action: overrides.action ?? "agency.suspend",
    createdAt: overrides.createdAt ?? new Date("2026-06-30T12:00:00Z"),
    note: overrides.note ?? null,
    ipAddress: overrides.ipAddress ?? null,
    userAgent: overrides.userAgent ?? null,
    targetAgencyId: overrides.targetAgencyId ?? null,
    targetMemberId: overrides.targetMemberId ?? null,
    targetEntityType: overrides.targetEntityType ?? null,
    targetEntityId: overrides.targetEntityId ?? null,
    before: overrides.before ?? null,
    after: overrides.after ?? null,
    bySystemAdmin: overrides.admin ?? {
      id: "sa_1",
      email: "ops@example.com",
      name: null,
      role: "ROOT" as SystemAdminRole,
    },
  };
}
