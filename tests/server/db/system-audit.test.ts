/**
 * The audit wrapper is the load-bearing primitive behind every ROOT-side
 * write. Its single guarantee — "no mutation lands without a paired audit
 * row, no audit row lands without a paired mutation" — has to be enforced
 * at the TX layer or the whole audit story is theater. These tests pin
 * that guarantee from both directions.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
  },
}));

vi.mock("@/server/db/client", () => ({ prisma: mocks.prisma }));

import { SYSTEM_AUDIT_ACTIONS } from "@/server/db/system/audit-actions";
import { withSystemAudit } from "@/server/db/system/audit";
import type { SystemAdminContext } from "@/server/auth/system";

const ctx: SystemAdminContext = {
  user: { clerkUserId: "user_1", email: "ops@example.com", name: "Ops", imageUrl: null },
  admin: { id: "sa_1", role: "ROOT", mfaEnforced: true },
};

/**
 * Build a fake `tx` client that the wrapper can hand to the callback. The
 * audit row write is captured into `auditWrites` so the test can assert
 * shape + that it actually ran.
 */
type AuditCreateArgs = { data: Record<string, unknown> };
type AgencyUpdateArgs = { where: { id: string }; data: Record<string, unknown> };

type FakeTx = {
  systemAuditLog: {
    create: (args: AuditCreateArgs) => Promise<unknown>;
  };
  agency: {
    update: (args: AgencyUpdateArgs) => Promise<Record<string, unknown>>;
  };
};

function buildFakeTx() {
  const auditWrites: Record<string, unknown>[] = [];
  const mutationWrites: Record<string, unknown>[] = [];

  const create = vi.fn(async ({ data }: AuditCreateArgs) => {
    auditWrites.push(data);
    return data;
  });
  const update = vi.fn(async (input: AgencyUpdateArgs) => {
    mutationWrites.push(input.data);
    return { id: input.where.id, ...input.data };
  });

  const tx: FakeTx = {
    systemAuditLog: { create },
    agency: { update },
  };

  return { tx, auditWrites, mutationWrites, mocks: { create, update } };
}

beforeEach(() => {
  mocks.prisma.$transaction.mockReset();
});

describe("withSystemAudit", () => {
  it("writes the audit row inside the same $transaction as the mutation", async () => {
    const { tx, auditWrites, mutationWrites } = buildFakeTx();
    // The wrapper expects `$transaction(async (tx) => fn(tx))` to be honored.
    // Our fake just invokes the callback with our fake tx — exactly what a
    // real Prisma TX would do once the callback runs.
    mocks.prisma.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(tx),
    );

    await withSystemAudit(
      ctx,
      {
        action: SYSTEM_AUDIT_ACTIONS.AGENCY_SUSPEND,
        targetAgencyId: "agc_1",
        note: "Spam reports",
      },
      async (innerTx, audit) => {
        audit.setBefore({ suspendedAt: null });
        const after = await (innerTx as unknown as FakeTx).agency.update({
          where: { id: "agc_1" },
          data: { suspendedAt: new Date("2026-06-30") },
        });
        audit.setAfter(after);
        return after;
      },
    );

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mutationWrites).toHaveLength(1);
    expect(auditWrites).toHaveLength(1);

    const audit = auditWrites[0] as Record<string, unknown>;
    expect(audit.bySystemAdminId).toBe("sa_1");
    expect(audit.action).toBe("agency.suspend");
    expect(audit.targetAgencyId).toBe("agc_1");
    expect(audit.note).toBe("Spam reports");
    expect(audit.before).toEqual({ suspendedAt: null });
    expect(audit.after).toMatchObject({ suspendedAt: "2026-06-30T00:00:00.000Z" });
  });

  it("if the mutation throws inside the callback, the audit row is NEVER written", async () => {
    const { tx, auditWrites } = buildFakeTx();
    mocks.prisma.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(tx),
    );

    await expect(
      withSystemAudit(
        ctx,
        { action: SYSTEM_AUDIT_ACTIONS.AGENCY_SUSPEND, targetAgencyId: "agc_1" },
        async () => {
          throw new Error("repo blew up");
        },
      ),
    ).rejects.toThrow("repo blew up");

    expect(auditWrites).toHaveLength(0);
  });

  it("if the audit row write throws, the wrapper rejects (forcing a TX rollback)", async () => {
    const { tx, mocks: txMocks } = buildFakeTx();
    txMocks.create.mockImplementationOnce(async () => {
      throw new Error("audit insert failed");
    });
    mocks.prisma.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(tx),
    );

    // The mutation can have run on the fake tx, but the wrapper still rejects
    // — that rejection is what a real Prisma TX picks up to roll the whole
    // thing back. The guarantee is that the wrapper PROPAGATES the failure,
    // not that it eats it.
    await expect(
      withSystemAudit(
        ctx,
        { action: SYSTEM_AUDIT_ACTIONS.AGENCY_SUSPEND, targetAgencyId: "agc_1" },
        async (innerTx) => {
          return (innerTx as unknown as FakeTx).agency.update({
            where: { id: "agc_1" },
            data: { suspendedAt: new Date() },
          });
        },
      ),
    ).rejects.toThrow("audit insert failed");
  });

  it("snapshot defaults to null when neither setBefore nor setAfter is called", async () => {
    const { tx, auditWrites } = buildFakeTx();
    mocks.prisma.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(tx),
    );

    await withSystemAudit(
      ctx,
      { action: SYSTEM_AUDIT_ACTIONS.SUPPORT_RESEND_WELCOME, targetAgencyId: "agc_1" },
      async () => undefined,
    );

    const audit = auditWrites[0] as Record<string, unknown>;
    // We pass `Prisma.JsonNull` to the column so SQL-side it lands as
    // JSON null (not SQL NULL). The wrapper translates `null` to `JsonNull`
    // — assert the path was taken by checking the prop is present + non-undefined.
    expect(audit).toHaveProperty("before");
    expect(audit).toHaveProperty("after");
    expect(audit.before).not.toBeUndefined();
    expect(audit.after).not.toBeUndefined();
  });

  it("setBefore / setAfter deep-clone values so a later mutation of the input doesn't poison the snapshot", async () => {
    const { tx, auditWrites } = buildFakeTx();
    mocks.prisma.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(tx),
    );

    const live = { plan: "STUDIO" as const, mutable: { count: 1 } };

    await withSystemAudit(
      ctx,
      { action: SYSTEM_AUDIT_ACTIONS.AGENCY_GRANT_PLAN_OVERRIDE, targetAgencyId: "agc_1" },
      async (_innerTx, audit) => {
        audit.setBefore(live);
        // Mutate the source object AFTER the snapshot was taken — the
        // captured `before` must still hold the pre-mutation shape, since
        // the wrapper calls `JSON.parse(JSON.stringify(...))`.
        live.mutable.count = 99;
        return undefined;
      },
    );

    const audit = auditWrites[0] as Record<string, unknown>;
    expect(audit.before).toEqual({ plan: "STUDIO", mutable: { count: 1 } });
  });
});
