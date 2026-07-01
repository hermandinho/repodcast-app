/**
 * Phase 3.6.6 step 10 — write-mode impersonation promote helper.
 *
 * Pinned guarantees:
 *   - `promoteImpersonationToWrite` is ROOT-only. OPERATOR, SUPPORT, ANALYST
 *     all throw `ForbiddenError` — no audit row, no TX.
 *   - When the target member's `agencyId` no longer matches (member deleted
 *     or moved between agencies) the promotion throws `NotFoundError`
 *     inside the TX so the audit row rolls back with the failed write.
 *   - On success, exactly one audit row lands with action
 *     `impersonate.promote_write`, `targetAgencyId` + `targetMemberId`
 *     stamped, and before/after snapshots reflecting the mode swap.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemAdminRole } from "@prisma/client";
import { ForbiddenError, NotFoundError } from "@/server/auth/errors";

const mocks = vi.hoisted(() => ({
  memberFindUnique: vi.fn(),
  systemAuditLogCreate: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    $transaction: mocks.$transaction,
  },
}));

import type { SystemAdminContext } from "@/server/auth/system";
import { promoteImpersonationToWrite } from "@/server/db/system/impersonation";

function ctx(role: SystemAdminRole = "ROOT"): SystemAdminContext {
  return {
    user: { clerkUserId: "user_1", email: "root@example.com", name: null, imageUrl: null },
    admin: { id: "sa_root", role, mfaEnforced: true },
  };
}

function buildFakeTx() {
  const auditWrites: Record<string, unknown>[] = [];
  const tx = {
    systemAuditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditWrites.push(data);
        return data;
      }),
    },
    member: {
      findUnique: mocks.memberFindUnique,
    },
  };
  return { tx, auditWrites };
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

// ============================================================
// Role gate
// ============================================================

describe("promoteImpersonationToWrite — role gate", () => {
  it("rejects OPERATOR / SUPPORT / ANALYST with ForbiddenError before any TX", async () => {
    for (const role of ["OPERATOR", "SUPPORT", "ANALYST"] satisfies SystemAdminRole[]) {
      await expect(
        promoteImpersonationToWrite(ctx(role), {
          agencyId: "agc_1",
          memberId: "mem_1",
          startedAt: new Date().toISOString(),
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("allows ROOT", async () => {
    mocks.memberFindUnique.mockResolvedValueOnce({ id: "mem_1", agencyId: "agc_1" });
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    await expect(
      promoteImpersonationToWrite(ctx("ROOT"), {
        agencyId: "agc_1",
        memberId: "mem_1",
        startedAt: new Date("2026-07-01T10:00:00Z").toISOString(),
      }),
    ).resolves.toBeUndefined();
  });
});

// ============================================================
// Audit shape
// ============================================================

describe("promoteImpersonationToWrite — audit row", () => {
  it("writes impersonate.promote_write with target ids + mode-swap snapshots", async () => {
    mocks.memberFindUnique.mockResolvedValueOnce({ id: "mem_1", agencyId: "agc_1" });
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    const startedAt = new Date("2026-07-01T10:00:00Z").toISOString();
    await promoteImpersonationToWrite(ctx(), {
      agencyId: "agc_1",
      memberId: "mem_1",
      startedAt,
      ipAddress: "10.0.0.1",
      userAgent: "test-ua",
    });

    expect(fake.auditWrites).toHaveLength(1);
    const audit = fake.auditWrites[0]!;
    expect(audit.action).toBe("impersonate.promote_write");
    expect(audit.targetAgencyId).toBe("agc_1");
    expect(audit.targetMemberId).toBe("mem_1");
    expect(audit.ipAddress).toBe("10.0.0.1");
    expect(audit.userAgent).toBe("test-ua");

    const before = audit.before as { mode: string; startedAt: string };
    const after = audit.after as { mode: string; startedAt: string; promotedAt: string };
    expect(before.mode).toBe("read");
    expect(before.startedAt).toBe(startedAt);
    expect(after.mode).toBe("write");
    expect(after.startedAt).toBe(startedAt);
    expect(typeof after.promotedAt).toBe("string");
  });
});

// ============================================================
// Stale envelope handling
// ============================================================

describe("promoteImpersonationToWrite — stale envelope", () => {
  it("throws NotFoundError when the target member no longer exists", async () => {
    mocks.memberFindUnique.mockResolvedValueOnce(null);
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    await expect(
      promoteImpersonationToWrite(ctx(), {
        agencyId: "agc_1",
        memberId: "mem_gone",
        startedAt: new Date().toISOString(),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // The audit row is INSIDE the TX callback, so the NotFoundError throwing
    // out of the callback prevents the audit `create` from ever running.
    expect(fake.auditWrites).toHaveLength(0);
  });

  it("throws NotFoundError when the target member has moved between agencies", async () => {
    // Member row still exists but now points at a different agency — the
    // cookie's agencyId is stale.
    mocks.memberFindUnique.mockResolvedValueOnce({ id: "mem_1", agencyId: "agc_different" });
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    await expect(
      promoteImpersonationToWrite(ctx(), {
        agencyId: "agc_1",
        memberId: "mem_1",
        startedAt: new Date().toISOString(),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
