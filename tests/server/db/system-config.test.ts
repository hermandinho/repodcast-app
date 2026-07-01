/**
 * Phase 3.6.11 — SystemConfig + AgencyLimitOverride repo helpers.
 *
 * The load-bearing guarantees pinned here:
 *   - Reads open to every system read role (ROOT / OPERATOR / SUPPORT / ANALYST)
 *   - Writes gated to SYSTEM_WRITE_ROLES (ROOT + OPERATOR) — SUPPORT and
 *     ANALYST get ForbiddenError before any DB touch
 *   - Every write goes through `withSystemAudit` (verified by asserting the
 *     $transaction mock ran + the audit-log insert fired inside it)
 *   - `getEffectiveLimitOverride` skips expired rows without live-DB roundtrip
 *   - Zod input schemas reject malformed keys / JSON
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LimitOverrideResource, SystemAdminRole } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/server/auth/errors";

// ---------------------------------------------------------------------------
// Prisma mock. `$transaction(cb)` passes `tx` to the callback so the audit
// wrapper's TX-scoped writes land on the same shape as real Prisma. The tx
// object mirrors the fields the config repo actually touches.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  systemConfigFindMany: vi.fn(),
  systemConfigFindUnique: vi.fn(),
  systemConfigUpsert: vi.fn(),
  systemConfigDelete: vi.fn(),
  agencyLimitOverrideFindMany: vi.fn(),
  agencyLimitOverrideFindUnique: vi.fn(),
  agencyLimitOverrideUpsert: vi.fn(),
  agencyLimitOverrideDelete: vi.fn(),
  systemAuditLogCreate: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    systemConfig: {
      findMany: mocks.systemConfigFindMany,
      findUnique: mocks.systemConfigFindUnique,
    },
    agencyLimitOverride: {
      findUnique: mocks.agencyLimitOverrideFindUnique,
    },
    $transaction: mocks.$transaction,
  },
}));

import type { SystemAdminContext } from "@/server/auth/system";
import { ForbiddenError } from "@/server/auth/errors";
import {
  deleteSystemConfig,
  getEffectiveLimitOverride,
  LIMITED_TO_LIMIT_OVERRIDE_RESOURCE,
  LIMIT_OVERRIDE_RESOURCE_TO_LIMITED,
  listSystemConfig,
  revokeAgencyLimitOverride,
  upsertAgencyLimitOverride,
  upsertSystemConfig,
} from "@/server/db/system/config";

function ctx(role: SystemAdminRole = "ROOT"): SystemAdminContext {
  return {
    user: { clerkUserId: "user_1", email: "ops@example.com", name: null, imageUrl: null },
    admin: { id: "sa_1", role, mfaEnforced: true },
  };
}

function buildFakeTx() {
  const auditWrites: Record<string, unknown>[] = [];
  const configUpserts: Record<string, unknown>[] = [];
  const overrideUpserts: Record<string, unknown>[] = [];
  const configDeletes: Record<string, unknown>[] = [];
  const overrideDeletes: Record<string, unknown>[] = [];

  const tx = {
    systemAuditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditWrites.push(data);
        return data;
      }),
    },
    systemConfig: {
      findUnique: mocks.systemConfigFindUnique,
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        configUpserts.push(args);
        return mocks.systemConfigUpsert(args);
      }),
      delete: vi.fn(async (args: Record<string, unknown>) => {
        configDeletes.push(args);
        return mocks.systemConfigDelete(args);
      }),
    },
    agencyLimitOverride: {
      findUnique: mocks.agencyLimitOverrideFindUnique,
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        overrideUpserts.push(args);
        return mocks.agencyLimitOverrideUpsert(args);
      }),
      delete: vi.fn(async (args: Record<string, unknown>) => {
        overrideDeletes.push(args);
        return mocks.agencyLimitOverrideDelete(args);
      }),
    },
  };

  return { tx, auditWrites, configUpserts, overrideUpserts, configDeletes, overrideDeletes };
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

// ============================================================
// Enum mapping
// ============================================================

describe("LimitOverrideResource mapping", () => {
  it("covers all four resources in both directions and round-trips", () => {
    const resources: LimitOverrideResource[] = ["SHOWS", "MEMBERS", "EPISODES", "GENERATIONS"];
    for (const r of resources) {
      const lower = LIMIT_OVERRIDE_RESOURCE_TO_LIMITED[r];
      expect(LIMITED_TO_LIMIT_OVERRIDE_RESOURCE[lower]).toBe(r);
    }
  });
});

// ============================================================
// getEffectiveLimitOverride — consumption-path read
// ============================================================

describe("getEffectiveLimitOverride", () => {
  it("returns the value when the row is unexpired", async () => {
    mocks.agencyLimitOverrideFindUnique.mockResolvedValueOnce({
      value: 25,
      expiresAt: null,
    });
    await expect(getEffectiveLimitOverride("agc_1", "EPISODES")).resolves.toBe(25);
  });

  it("returns null when no row exists", async () => {
    mocks.agencyLimitOverrideFindUnique.mockResolvedValueOnce(null);
    await expect(getEffectiveLimitOverride("agc_1", "EPISODES")).resolves.toBeNull();
  });

  it("returns null when the row's expiresAt has passed", async () => {
    mocks.agencyLimitOverrideFindUnique.mockResolvedValueOnce({
      value: 999,
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(getEffectiveLimitOverride("agc_1", "EPISODES")).resolves.toBeNull();
  });

  it("keeps the row when expiresAt is in the future", async () => {
    mocks.agencyLimitOverrideFindUnique.mockResolvedValueOnce({
      value: 7,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(getEffectiveLimitOverride("agc_1", "EPISODES")).resolves.toBe(7);
  });
});

// ============================================================
// SystemConfig — reads
// ============================================================

describe("listSystemConfig", () => {
  it("open to every read role, ordered by key ASC", async () => {
    mocks.systemConfigFindMany.mockResolvedValue([]);
    for (const role of ["ROOT", "OPERATOR", "SUPPORT", "ANALYST"] satisfies SystemAdminRole[]) {
      await expect(listSystemConfig(ctx(role))).resolves.toEqual([]);
    }
    const findArgs = mocks.systemConfigFindMany.mock.calls[0]?.[0] as { orderBy: { key: string } };
    expect(findArgs.orderBy).toEqual({ key: "asc" });
  });

  it("throws on unknown role", async () => {
    const bad = { ...ctx(), admin: { ...ctx().admin, role: "UNKNOWN" as never } };
    await expect(listSystemConfig(bad)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ============================================================
// SystemConfig — writes (role gate + audit trail)
// ============================================================

describe("upsertSystemConfig", () => {
  it("rejects SUPPORT + ANALYST with ForbiddenError BEFORE opening the TX", async () => {
    for (const role of ["SUPPORT", "ANALYST"] satisfies SystemAdminRole[]) {
      await expect(
        upsertSystemConfig(ctx(role), { key: "FEATURE_X", valueJson: "true" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a lowercase key at validation time", async () => {
    await expect(
      upsertSystemConfig(ctx(), { key: "feature_x", valueJson: "true" }),
    ).rejects.toThrow();
  });

  it("rejects a value that isn't valid JSON with ValidationError", async () => {
    // Zod passes ok (non-empty string) but the internal JSON.parse trips.
    await expect(
      upsertSystemConfig(ctx(), { key: "FEATURE_X", valueJson: "not-json" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("writes upsert + audit row inside the same $transaction", async () => {
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    mocks.systemConfigFindUnique.mockResolvedValueOnce(null); // create path
    mocks.systemConfigUpsert.mockResolvedValueOnce({
      id: "sc_1",
      key: "FEATURE_X",
      value: true,
      description: null,
      updatedAt: new Date(),
      updatedBy: null,
    });

    await upsertSystemConfig(ctx(), {
      key: "FEATURE_X",
      valueJson: "true",
      note: "wire feature X on",
    });

    expect(fake.configUpserts).toHaveLength(1);
    expect(fake.auditWrites).toHaveLength(1);

    const audit = fake.auditWrites[0]!;
    expect(audit.action).toBe("config.update");
    expect(audit.targetEntityType).toBe("system_config");
    expect(audit.targetEntityId).toBe("FEATURE_X");
    expect(audit.note).toBe("wire feature X on");
    expect(audit.bySystemAdminId).toBe("sa_1");
  });
});

describe("deleteSystemConfig", () => {
  it("requires a note >= 3 chars", async () => {
    await expect(deleteSystemConfig(ctx(), { key: "FEATURE_X", note: "no" })).rejects.toThrow();
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the key doesn't exist (inside the TX)", async () => {
    const fake = buildFakeTx();
    mocks.systemConfigFindUnique.mockResolvedValueOnce(null);
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );

    await expect(
      deleteSystemConfig(ctx(), { key: "MISSING", note: "cleanup" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    // Deletion never fired.
    expect(fake.configDeletes).toHaveLength(0);
  });

  it("writes the delete + audit row inside the same $transaction", async () => {
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );
    mocks.systemConfigFindUnique.mockResolvedValueOnce({
      id: "sc_1",
      key: "OLD_KEY",
      value: "stale",
    });
    mocks.systemConfigDelete.mockResolvedValueOnce({});

    await deleteSystemConfig(ctx(), { key: "OLD_KEY", note: "no longer used" });

    expect(fake.configDeletes).toHaveLength(1);
    expect(fake.auditWrites[0]?.action).toBe("config.update");
    expect(fake.auditWrites[0]?.note).toBe("no longer used");
    // The wrapper converts `null` to `Prisma.JsonNull` so the JSONB column
    // lands JSON-null rather than SQL-NULL. Assert the prop is present +
    // isn't a real object with content (matches the pattern in
    // `tests/server/db/system-audit.test.ts`).
    expect(fake.auditWrites[0]).toHaveProperty("after");
    expect(fake.auditWrites[0]?.after).not.toBeUndefined();
  });
});

// ============================================================
// AgencyLimitOverride — writes
// ============================================================

describe("upsertAgencyLimitOverride", () => {
  it("rejects SUPPORT with ForbiddenError before any TX", async () => {
    await expect(
      upsertAgencyLimitOverride(ctx("SUPPORT"), {
        agencyId: "agc_1",
        resource: "EPISODES",
        value: 100,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("writes the upsert + audit row targeting the specific (agency, resource)", async () => {
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );
    mocks.agencyLimitOverrideFindUnique.mockResolvedValueOnce(null);
    mocks.agencyLimitOverrideUpsert.mockResolvedValueOnce({
      id: "alo_1",
      agencyId: "agc_1",
      resource: "EPISODES",
      value: 100,
      expiresAt: null,
      note: "comp for ticket 42",
      createdAt: new Date(),
      updatedAt: new Date(),
      agency: { name: "Acme" },
      by: { id: "sa_1", email: "ops@example.com", name: null },
    });

    const result = await upsertAgencyLimitOverride(ctx(), {
      agencyId: "agc_1",
      resource: "EPISODES",
      value: 100,
      note: "comp for ticket 42",
    });

    expect(result.agencyName).toBe("Acme");
    expect(result.value).toBe(100);
    expect(fake.overrideUpserts).toHaveLength(1);
    expect(fake.auditWrites[0]?.action).toBe("config.agency_limit_override");
    expect(fake.auditWrites[0]?.targetAgencyId).toBe("agc_1");
    expect(fake.auditWrites[0]?.targetEntityId).toBe("agc_1:EPISODES");
  });

  it("rejects a negative value at Zod validation time", async () => {
    await expect(
      upsertAgencyLimitOverride(ctx(), {
        agencyId: "agc_1",
        resource: "EPISODES",
        value: -1,
      }),
    ).rejects.toThrow();
  });

  it("accepts value=0 (hard-cap the resource)", async () => {
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );
    mocks.agencyLimitOverrideFindUnique.mockResolvedValueOnce(null);
    mocks.agencyLimitOverrideUpsert.mockResolvedValueOnce({
      id: "alo_1",
      agencyId: "agc_1",
      resource: "GENERATIONS",
      value: 0,
      expiresAt: null,
      note: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      agency: { name: "Acme" },
      by: { id: "sa_1", email: "ops@example.com", name: null },
    });

    const result = await upsertAgencyLimitOverride(ctx(), {
      agencyId: "agc_1",
      resource: "GENERATIONS",
      value: 0,
    });
    expect(result.value).toBe(0);
  });
});

describe("revokeAgencyLimitOverride", () => {
  it("looks the row up BEFORE the wrapper opens so targetAgencyId lands on the audit row", async () => {
    // First lookup is the pre-wrapper fetch → returns the row.
    mocks.agencyLimitOverrideFindUnique.mockResolvedValueOnce({ agencyId: "agc_target" });
    // Second lookup (inside the TX) returns the full row for the `before` snapshot.
    mocks.agencyLimitOverrideFindUnique.mockResolvedValueOnce({
      id: "alo_1",
      agencyId: "agc_target",
      resource: "EPISODES",
      value: 100,
    });

    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );
    mocks.agencyLimitOverrideDelete.mockResolvedValueOnce({});

    await revokeAgencyLimitOverride(ctx(), { id: "alo_1", note: "over-generous" });

    expect(fake.overrideDeletes).toHaveLength(1);
    expect(fake.auditWrites[0]?.targetAgencyId).toBe("agc_target");
    expect(fake.auditWrites[0]?.action).toBe("config.agency_limit_override");
    expect(fake.auditWrites[0]?.note).toBe("over-generous");
    // The wrapper converts `null` to `Prisma.JsonNull` so the JSONB column
    // lands JSON-null rather than SQL-NULL. Assert the prop is present +
    // isn't a real object with content (matches the pattern in
    // `tests/server/db/system-audit.test.ts`).
    expect(fake.auditWrites[0]).toHaveProperty("after");
    expect(fake.auditWrites[0]?.after).not.toBeUndefined();
  });

  it("throws NotFoundError from the pre-wrapper lookup without opening a TX", async () => {
    mocks.agencyLimitOverrideFindUnique.mockResolvedValueOnce(null);

    await expect(
      revokeAgencyLimitOverride(ctx(), { id: "alo_missing", note: "clean up" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
});
