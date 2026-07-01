/**
 * Phase 3.6.9 — cross-agency user search.
 *
 * Pins the load-bearing surface:
 *   - role gate rejects non-read roles
 *   - empty search short-circuits without touching the DB
 *   - substring where covers email OR name; `user_…` prefix ALSO adds an
 *     exact clerkUserId clause
 *   - result set is deduplicated by clerkUserId; the canonical identity on
 *     each row is the most-recently-updated Member row
 *   - memberships within a row are sorted OWNER → ADMIN → EDITOR → REVIEWER
 *   - pagination applies AFTER the groupBy so `total` reflects distinct
 *     users, not raw Member rows
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberRole, Plan, SystemAdminRole } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  memberGroupBy: vi.fn(),
  memberFindMany: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    member: {
      groupBy: mocks.memberGroupBy,
      findMany: mocks.memberFindMany,
    },
  },
}));

import { ForbiddenError } from "@/server/auth/errors";
import type { SystemAdminContext } from "@/server/auth/system";
import { searchMembersForRoot } from "@/server/db/system/users";

function ctx(role: SystemAdminRole = "ROOT"): SystemAdminContext {
  return {
    user: { clerkUserId: "user_1", email: "ops@example.com", name: null, imageUrl: null },
    admin: { id: "sa_1", role, mfaEnforced: true },
  };
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.memberGroupBy.mockResolvedValue([]);
  mocks.memberFindMany.mockResolvedValue([]);
});

// ============================================================
// Role gate + empty-search short-circuit
// ============================================================

describe("searchMembersForRoot — gate + empty search", () => {
  it("rejects a role not in SYSTEM_READ_ROLES", async () => {
    const bad = { ...ctx(), admin: { ...ctx().admin, role: "UNKNOWN" as never } };
    await expect(searchMembersForRoot(bad, { search: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns zero rows without querying when search is omitted", async () => {
    const result = await searchMembersForRoot(ctx(), {});
    expect(result).toEqual({ rows: [], total: 0 });
    expect(mocks.memberGroupBy).not.toHaveBeenCalled();
    expect(mocks.memberFindMany).not.toHaveBeenCalled();
  });

  it("returns zero rows for a whitespace-only search (Zod trims)", async () => {
    const result = await searchMembersForRoot(ctx(), { search: "   " });
    expect(result).toEqual({ rows: [], total: 0 });
    expect(mocks.memberGroupBy).not.toHaveBeenCalled();
  });
});

// ============================================================
// Where-clause shape
// ============================================================

describe("searchMembersForRoot — where-clause", () => {
  it("emits an OR of email + name substrings for a plain search", async () => {
    await searchMembersForRoot(ctx(), { search: "alice" });
    const groupByArgs = mocks.memberGroupBy.mock.calls[0]?.[0] as {
      where: { OR: Array<Record<string, unknown>> };
    };
    expect(groupByArgs.where.OR).toEqual([
      { email: { contains: "alice", mode: "insensitive" } },
      { name: { contains: "alice", mode: "insensitive" } },
    ]);
  });

  it("adds an exact clerkUserId clause when search starts with `user_`", async () => {
    await searchMembersForRoot(ctx(), { search: "user_ABC123" });
    const groupByArgs = mocks.memberGroupBy.mock.calls[0]?.[0] as {
      where: { OR: Array<Record<string, unknown>> };
    };
    expect(groupByArgs.where.OR).toContainEqual({ clerkUserId: "user_ABC123" });
    // Still includes the substring clauses — an operator pasting a partial
    // id from Clerk might have "user_" as a prefix on both name and id
    // simultaneously.
    expect(groupByArgs.where.OR).toContainEqual({
      email: { contains: "user_ABC123", mode: "insensitive" },
    });
  });
});

// ============================================================
// Aggregation + pagination
// ============================================================

describe("searchMembersForRoot — aggregation", () => {
  it("groups by clerkUserId and reports distinct-user total", async () => {
    mocks.memberGroupBy.mockResolvedValueOnce([
      { clerkUserId: "user_a", _max: { updatedAt: new Date("2026-06-30T10:00:00Z") } },
      { clerkUserId: "user_b", _max: { updatedAt: new Date("2026-06-30T09:00:00Z") } },
      { clerkUserId: "user_c", _max: { updatedAt: new Date("2026-06-30T08:00:00Z") } },
    ]);
    mocks.memberFindMany.mockResolvedValueOnce([
      buildMemberRow({
        clerkUserId: "user_a",
        agencyId: "agc_1",
        agencyName: "Acme",
        role: "OWNER",
      }),
      buildMemberRow({
        clerkUserId: "user_a",
        agencyId: "agc_2",
        agencyName: "Beta",
        role: "EDITOR",
      }),
      buildMemberRow({ clerkUserId: "user_b", agencyId: "agc_3", agencyName: "Delta" }),
      buildMemberRow({ clerkUserId: "user_c", agencyId: "agc_4", agencyName: "Epsilon" }),
    ]);

    const result = await searchMembersForRoot(ctx(), { search: "acme" });

    expect(result.total).toBe(3);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].clerkUserId).toBe("user_a");
    // user_a has two memberships, one row per agency.
    expect(result.rows[0].memberships).toHaveLength(2);
    expect(result.rows[1].memberships).toHaveLength(1);
  });

  it("orders memberships within a row by role rank (OWNER → REVIEWER)", async () => {
    mocks.memberGroupBy.mockResolvedValueOnce([
      { clerkUserId: "user_a", _max: { updatedAt: new Date() } },
    ]);
    mocks.memberFindMany.mockResolvedValueOnce([
      buildMemberRow({
        clerkUserId: "user_a",
        agencyId: "agc_reviewer",
        agencyName: "Rev",
        role: "REVIEWER",
      }),
      buildMemberRow({
        clerkUserId: "user_a",
        agencyId: "agc_owner",
        agencyName: "Own",
        role: "OWNER",
      }),
      buildMemberRow({
        clerkUserId: "user_a",
        agencyId: "agc_editor",
        agencyName: "Edit",
        role: "EDITOR",
      }),
    ]);

    const result = await searchMembersForRoot(ctx(), { search: "x" });
    expect(result.rows[0].memberships.map((m) => m.role)).toEqual(["OWNER", "EDITOR", "REVIEWER"]);
  });

  it("uses the most-recent Member row for canonical email + name", async () => {
    mocks.memberGroupBy.mockResolvedValueOnce([
      { clerkUserId: "user_a", _max: { updatedAt: new Date("2026-06-30T10:00:00Z") } },
    ]);
    // The `updatedAt: 2026-06-30T10:00:00Z` row should win — even if it
    // appears first, the canonical selection is by timestamp.
    mocks.memberFindMany.mockResolvedValueOnce([
      buildMemberRow({
        clerkUserId: "user_a",
        agencyId: "agc_stale",
        agencyName: "Stale",
        email: "stale@example.com",
        name: "Stale Name",
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      }),
      buildMemberRow({
        clerkUserId: "user_a",
        agencyId: "agc_fresh",
        agencyName: "Fresh",
        email: "fresh@example.com",
        name: "Fresh Name",
        updatedAt: new Date("2026-06-30T10:00:00Z"),
      }),
    ]);

    const result = await searchMembersForRoot(ctx(), { search: "x" });
    expect(result.rows[0].email).toBe("fresh@example.com");
    expect(result.rows[0].name).toBe("Fresh Name");
    expect(result.rows[0].lastActiveAt).toEqual(new Date("2026-06-30T10:00:00Z"));
  });

  it("orders rows by most-recent-membership updatedAt DESC", async () => {
    mocks.memberGroupBy.mockResolvedValueOnce([
      { clerkUserId: "user_middle", _max: { updatedAt: new Date("2026-06-15T00:00:00Z") } },
      { clerkUserId: "user_newest", _max: { updatedAt: new Date("2026-06-30T00:00:00Z") } },
      { clerkUserId: "user_oldest", _max: { updatedAt: new Date("2026-05-01T00:00:00Z") } },
    ]);
    mocks.memberFindMany.mockResolvedValueOnce([
      buildMemberRow({ clerkUserId: "user_middle" }),
      buildMemberRow({ clerkUserId: "user_newest" }),
      buildMemberRow({ clerkUserId: "user_oldest" }),
    ]);

    const result = await searchMembersForRoot(ctx(), { search: "x" });
    expect(result.rows.map((r) => r.clerkUserId)).toEqual([
      "user_newest",
      "user_middle",
      "user_oldest",
    ]);
  });

  it("applies pagination on the grouped rows, not raw members", async () => {
    // 30 distinct users → page 2 with take=25 should return 5 rows, total=30.
    const groups = Array.from({ length: 30 }, (_, i) => ({
      clerkUserId: `user_${String(i).padStart(2, "0")}`,
      _max: { updatedAt: new Date(2026, 5, 30 - i) },
    }));
    mocks.memberGroupBy.mockResolvedValueOnce(groups);

    // Return one Member row per visible clerkUserId — the findMany call
    // filters `in: pageIds` so the mock echoes those back.
    mocks.memberFindMany.mockImplementationOnce(
      async (args: { where: { clerkUserId: { in: string[] } } }) =>
        args.where.clerkUserId.in.map((cid) => buildMemberRow({ clerkUserId: cid })),
    );

    const result = await searchMembersForRoot(ctx(), {
      search: "x",
      take: 25,
      skip: 25,
    });
    expect(result.total).toBe(30);
    expect(result.rows).toHaveLength(5);
    // Verify only the tail 5 clerkUserIds (sorted DESC by updatedAt) landed.
    expect(result.rows.map((r) => r.clerkUserId)).toEqual([
      "user_25",
      "user_26",
      "user_27",
      "user_28",
      "user_29",
    ]);
  });
});

// ============================================================
// Fixtures
// ============================================================

function buildMemberRow(overrides: {
  clerkUserId: string;
  agencyId?: string;
  agencyName?: string;
  agencyPlan?: Plan;
  memberId?: string;
  email?: string;
  name?: string | null;
  role?: MemberRole;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  return {
    id: overrides.memberId ?? `mbr_${overrides.clerkUserId}_${overrides.agencyId ?? "any"}`,
    clerkUserId: overrides.clerkUserId,
    email: overrides.email ?? `${overrides.clerkUserId}@example.com`,
    name: overrides.name ?? null,
    role: overrides.role ?? ("EDITOR" satisfies MemberRole),
    createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00Z"),
    updatedAt: overrides.updatedAt ?? new Date("2026-06-30T00:00:00Z"),
    agency: {
      id: overrides.agencyId ?? "agc_default",
      name: overrides.agencyName ?? "Default",
      plan: overrides.agencyPlan ?? ("STUDIO" satisfies Plan),
    },
  };
}
