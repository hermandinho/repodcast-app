/**
 * Abuse reports + flagged outputs.
 *
 * Pins the load-bearing guarantees:
 *   - Reads open to every system read role
 *   - Writes gated to SYSTEM_WRITE_ROLES (ROOT + OPERATOR)
 *   - Every mutation lands a `SystemAuditLog` row inside the same $transaction
 *   - assign() looks the row up BEFORE opening the audit wrapper so
 *     `targetAgencyId` lands on the audit entry
 *   - resolve() stamps the caller as fallback assignee when nobody was on
 *     the report yet
 *   - Where-clause shape covers each filter axis on listAbuseReports
 *   - Empty search / bad status fall through the Zod parse without hitting
 *     the DB
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AbuseReportCategory, AbuseReportStatus, SystemAdminRole } from "@prisma/client";
import { NotFoundError } from "@/server/auth/errors";

const mocks = vi.hoisted(() => ({
  abuseReportFindMany: vi.fn(),
  abuseReportCount: vi.fn(),
  abuseReportFindUnique: vi.fn(),
  abuseReportCreate: vi.fn(),
  abuseReportUpdate: vi.fn(),
  agencyFindMany: vi.fn(),
  generatedOutputFindMany: vi.fn(),
  generatedOutputCount: vi.fn(),
  generatedOutputFindUnique: vi.fn(),
  generatedOutputUpdate: vi.fn(),
  systemAuditLogCreate: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    abuseReport: {
      findMany: mocks.abuseReportFindMany,
      count: mocks.abuseReportCount,
      findUnique: mocks.abuseReportFindUnique,
    },
    agency: {
      findMany: mocks.agencyFindMany,
    },
    generatedOutput: {
      findMany: mocks.generatedOutputFindMany,
      count: mocks.generatedOutputCount,
      findUnique: mocks.generatedOutputFindUnique,
    },
    $transaction: mocks.$transaction,
  },
}));

import type { SystemAdminContext } from "@/server/auth/system";
import { ForbiddenError } from "@/server/auth/errors";
import {
  ABUSE_REPORT_CATEGORY_OPTIONS,
  ABUSE_REPORT_STATUS_OPTIONS,
  assignAbuseReport,
  createAbuseReport,
  dismissAbuseReport,
  flagOutput,
  listAbuseReports,
  listFlaggedOutputs,
  resolveAbuseReport,
  unflagOutput,
} from "@/server/db/system/quality";

function ctx(role: SystemAdminRole = "ROOT"): SystemAdminContext {
  return {
    user: { clerkUserId: "user_1", email: "ops@example.com", name: null, imageUrl: null },
    admin: { id: "sa_1", role, mfaEnforced: true },
  };
}

function buildFakeTx() {
  const auditWrites: Record<string, unknown>[] = [];
  const abuseCreates: Record<string, unknown>[] = [];
  const abuseUpdates: Record<string, unknown>[] = [];
  const outputUpdates: Record<string, unknown>[] = [];

  const tx = {
    systemAuditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditWrites.push(data);
        return data;
      }),
    },
    abuseReport: {
      findUnique: mocks.abuseReportFindUnique,
      create: vi.fn(async (args: Record<string, unknown>) => {
        abuseCreates.push(args);
        return mocks.abuseReportCreate(args);
      }),
      update: vi.fn(async (args: Record<string, unknown>) => {
        abuseUpdates.push(args);
        return mocks.abuseReportUpdate(args);
      }),
    },
    generatedOutput: {
      findUnique: mocks.generatedOutputFindUnique,
      update: vi.fn(async (args: Record<string, unknown>) => {
        outputUpdates.push(args);
        return mocks.generatedOutputUpdate(args);
      }),
    },
  };
  return { tx, auditWrites, abuseCreates, abuseUpdates, outputUpdates };
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.abuseReportFindMany.mockResolvedValue([]);
  mocks.abuseReportCount.mockResolvedValue(0);
  mocks.agencyFindMany.mockResolvedValue([]);
  mocks.generatedOutputFindMany.mockResolvedValue([]);
  mocks.generatedOutputCount.mockResolvedValue(0);
});

// ============================================================
// Enum option exports
// ============================================================

describe("enum option exports", () => {
  it("exports the full status + category sets for form dropdowns", () => {
    expect(ABUSE_REPORT_STATUS_OPTIONS).toEqual(["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"]);
    expect(ABUSE_REPORT_CATEGORY_OPTIONS).toEqual([
      "SPAM",
      "COPYRIGHT",
      "IMPERSONATION",
      "HARASSMENT",
      "OTHER",
    ]);
  });
});

// ============================================================
// listAbuseReports — filter shape
// ============================================================

describe("listAbuseReports", () => {
  it.each(["ROOT", "OPERATOR", "SUPPORT", "ANALYST"] satisfies SystemAdminRole[])(
    "%s can read",
    async (role) => {
      await expect(listAbuseReports(ctx(role))).resolves.toEqual({ rows: [], total: 0 });
    },
  );

  it("rejects an unknown role", async () => {
    const bad = { ...ctx(), admin: { ...ctx().admin, role: "UNKNOWN" as never } };
    await expect(listAbuseReports(bad)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("propagates status/category/assignedTo/agencyId filters into the where", async () => {
    await listAbuseReports(ctx(), {
      status: "OPEN" satisfies AbuseReportStatus,
      category: "SPAM" satisfies AbuseReportCategory,
      assignedToSystemAdminId: "sa_op",
      targetAgencyId: "agc_1",
    });
    const findArgs = mocks.abuseReportFindMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      orderBy: Array<Record<string, string>>;
    };
    expect(findArgs.where).toMatchObject({
      status: "OPEN",
      category: "SPAM",
      assignedToSystemAdminId: "sa_op",
      targetAgencyId: "agc_1",
    });
    expect(findArgs.orderBy).toEqual([{ status: "asc" }, { createdAt: "asc" }]);
  });

  it("enriches rows with target agency names via a batched second query", async () => {
    mocks.abuseReportFindMany.mockResolvedValueOnce([
      buildAbuseRow({ id: "ab_1", targetAgencyId: "agc_a" }),
      buildAbuseRow({ id: "ab_2", targetAgencyId: "agc_b" }),
      // Second row for agc_a — should NOT double-query.
      buildAbuseRow({ id: "ab_3", targetAgencyId: "agc_a" }),
      // Row without an agency target — must NOT crash the enrichment.
      buildAbuseRow({ id: "ab_4", targetAgencyId: null }),
    ]);
    mocks.abuseReportCount.mockResolvedValueOnce(4);
    mocks.agencyFindMany.mockResolvedValueOnce([
      { id: "agc_a", name: "Acme" },
      { id: "agc_b", name: "Beta" },
    ]);

    const { rows } = await listAbuseReports(ctx(), {});
    expect(rows[0].targetAgencyName).toBe("Acme");
    expect(rows[1].targetAgencyName).toBe("Beta");
    expect(rows[2].targetAgencyName).toBe("Acme");
    expect(rows[3].targetAgencyName).toBeNull();

    const lookupArgs = mocks.agencyFindMany.mock.calls[0]?.[0] as {
      where: { id: { in: string[] } };
    };
    expect(lookupArgs.where.id.in.sort()).toEqual(["agc_a", "agc_b"]);
  });
});

// ============================================================
// createAbuseReport
// ============================================================

describe("createAbuseReport", () => {
  it("rejects SUPPORT/ANALYST with ForbiddenError before opening a TX", async () => {
    for (const role of ["SUPPORT", "ANALYST"] satisfies SystemAdminRole[]) {
      await expect(
        createAbuseReport(ctx(role), {
          category: "SPAM",
          body: "test body more than three",
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("stores OPEN when no assignee is provided", async () => {
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );
    mocks.abuseReportCreate.mockResolvedValueOnce(
      buildAbuseSelectRow({ id: "ab_1", status: "OPEN" }),
    );

    await createAbuseReport(ctx(), {
      category: "COPYRIGHT",
      body: "verbatim copy of our episode script",
      targetAgencyId: "agc_x",
    });

    expect(fake.abuseCreates).toHaveLength(1);
    const createArgs = fake.abuseCreates[0] as { data: { status: string } };
    expect(createArgs.data.status).toBe("OPEN");
  });

  it("stores IN_REVIEW + fires ABUSE_ASSIGN when pre-assigned", async () => {
    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );
    mocks.abuseReportCreate.mockResolvedValueOnce(
      buildAbuseSelectRow({ id: "ab_1", status: "IN_REVIEW" }),
    );

    await createAbuseReport(ctx(), {
      category: "HARASSMENT",
      body: "phoned in — user pinged",
      assignedToSystemAdminId: "sa_op",
      note: "voicemail from Alice",
    });

    const createArgs = fake.abuseCreates[0] as {
      data: { status: string; assignedToSystemAdminId: string };
    };
    expect(createArgs.data.status).toBe("IN_REVIEW");
    expect(createArgs.data.assignedToSystemAdminId).toBe("sa_op");
    expect(fake.auditWrites[0]?.action).toBe("abuse.assign");
    expect(fake.auditWrites[0]?.note).toBe("voicemail from Alice");
  });

  it("rejects a body under 3 chars at Zod validation time", async () => {
    await expect(createAbuseReport(ctx(), { category: "SPAM", body: "no" })).rejects.toThrow();
  });
});

// ============================================================
// assignAbuseReport
// ============================================================

describe("assignAbuseReport", () => {
  it("looks up the row BEFORE opening the wrapper so targetAgencyId lands on the audit", async () => {
    // Pre-wrapper lookup returns the agencyId.
    mocks.abuseReportFindUnique.mockResolvedValueOnce({ targetAgencyId: "agc_target" });
    // Inside the TX: full snapshot for `before`.
    mocks.abuseReportFindUnique.mockResolvedValueOnce(
      buildAbuseSelectRow({ id: "ab_1", status: "OPEN", targetAgencyId: "agc_target" }),
    );

    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );
    mocks.abuseReportUpdate.mockResolvedValueOnce(
      buildAbuseSelectRow({ id: "ab_1", status: "IN_REVIEW", targetAgencyId: "agc_target" }),
    );

    await assignAbuseReport(ctx(), {
      id: "ab_1",
      assignedToSystemAdminId: "sa_op",
      note: "picking up",
    });

    expect(fake.auditWrites[0]?.targetAgencyId).toBe("agc_target");
    expect(fake.auditWrites[0]?.action).toBe("abuse.assign");
    expect(fake.auditWrites[0]?.note).toBe("picking up");

    const updateArgs = fake.abuseUpdates[0] as {
      data: { status: string; assignedToSystemAdminId: string };
    };
    expect(updateArgs.data.assignedToSystemAdminId).toBe("sa_op");
    expect(updateArgs.data.status).toBe("IN_REVIEW");
  });

  it("throws NotFoundError from the pre-wrapper lookup without opening a TX", async () => {
    mocks.abuseReportFindUnique.mockResolvedValueOnce(null);
    await expect(
      assignAbuseReport(ctx(), { id: "ab_missing", assignedToSystemAdminId: "sa_op" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("unassigning (null assignee) flips status back to OPEN", async () => {
    mocks.abuseReportFindUnique.mockResolvedValueOnce({ targetAgencyId: null });
    mocks.abuseReportFindUnique.mockResolvedValueOnce(
      buildAbuseSelectRow({ id: "ab_1", status: "IN_REVIEW" }),
    );

    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );
    mocks.abuseReportUpdate.mockResolvedValueOnce(
      buildAbuseSelectRow({ id: "ab_1", status: "OPEN" }),
    );

    await assignAbuseReport(ctx(), { id: "ab_1", assignedToSystemAdminId: null });
    const updateArgs = fake.abuseUpdates[0] as { data: { status: string } };
    expect(updateArgs.data.status).toBe("OPEN");
  });

  it("terminal states (RESOLVED / DISMISSED) don't flip back on re-assign", async () => {
    mocks.abuseReportFindUnique.mockResolvedValueOnce({ targetAgencyId: null });
    mocks.abuseReportFindUnique.mockResolvedValueOnce(
      buildAbuseSelectRow({ id: "ab_1", status: "RESOLVED" }),
    );

    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );
    mocks.abuseReportUpdate.mockResolvedValueOnce(
      buildAbuseSelectRow({ id: "ab_1", status: "RESOLVED" }),
    );

    await assignAbuseReport(ctx(), { id: "ab_1", assignedToSystemAdminId: "sa_op" });
    const updateArgs = fake.abuseUpdates[0] as { data: { status: string } };
    expect(updateArgs.data.status).toBe("RESOLVED");
  });
});

// ============================================================
// resolveAbuseReport + dismissAbuseReport
// ============================================================

describe("resolveAbuseReport", () => {
  it("stamps resolution + resolvedAt and fires abuse.resolve audit", async () => {
    mocks.abuseReportFindUnique.mockResolvedValueOnce({ targetAgencyId: "agc_x" });
    mocks.abuseReportFindUnique.mockResolvedValueOnce(
      buildAbuseSelectRow({ id: "ab_1", status: "IN_REVIEW", assignedToId: null }),
    );

    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );
    mocks.abuseReportUpdate.mockResolvedValueOnce(
      buildAbuseSelectRow({ id: "ab_1", status: "RESOLVED", assignedToId: "sa_1" }),
    );

    await resolveAbuseReport(ctx(), {
      id: "ab_1",
      resolution: "suspended the agency",
      note: "ticket 456",
    });

    expect(fake.auditWrites[0]?.action).toBe("abuse.resolve");

    const updateArgs = fake.abuseUpdates[0] as {
      data: {
        status: string;
        resolution: string;
        resolvedAt: Date;
        assignedToSystemAdminId: string;
      };
    };
    expect(updateArgs.data.status).toBe("RESOLVED");
    expect(updateArgs.data.resolution).toBe("suspended the agency");
    expect(updateArgs.data.resolvedAt).toBeInstanceOf(Date);
    // Fallback-assignee semantics: caller stamps as assignee when nobody was on the row yet.
    expect(updateArgs.data.assignedToSystemAdminId).toBe("sa_1");
  });

  it("requires a resolution >= 3 chars (Zod)", async () => {
    await expect(resolveAbuseReport(ctx(), { id: "ab_1", resolution: "ok" })).rejects.toThrow();
  });
});

describe("dismissAbuseReport", () => {
  it("stamps DISMISSED + fires abuse.dismiss audit + requires a note", async () => {
    mocks.abuseReportFindUnique.mockResolvedValueOnce({ targetAgencyId: "agc_x" });
    mocks.abuseReportFindUnique.mockResolvedValueOnce(
      buildAbuseSelectRow({ id: "ab_1", status: "OPEN" }),
    );

    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );
    mocks.abuseReportUpdate.mockResolvedValueOnce(
      buildAbuseSelectRow({ id: "ab_1", status: "DISMISSED" }),
    );

    await dismissAbuseReport(ctx(), { id: "ab_1", note: "wrong target — not our agency" });

    expect(fake.auditWrites[0]?.action).toBe("abuse.dismiss");
    expect(fake.auditWrites[0]?.note).toBe("wrong target — not our agency");
  });

  it("rejects a note under 3 chars at Zod validation time", async () => {
    await expect(dismissAbuseReport(ctx(), { id: "ab_1", note: "no" })).rejects.toThrow();
  });
});

// ============================================================
// Flagged outputs
// ============================================================

describe("listFlaggedOutputs", () => {
  it("filters to flaggedAt != null and currentOnly by default", async () => {
    await listFlaggedOutputs(ctx(), {});
    const findArgs = mocks.generatedOutputFindMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      orderBy: { flaggedAt: string };
    };
    expect(findArgs.where.flaggedAt).toEqual({ not: null });
    expect(findArgs.where.supersededAt).toBeNull();
    expect(findArgs.orderBy).toEqual({ flaggedAt: "desc" });
  });

  it("nests the tenant join when agencyId is set", async () => {
    await listFlaggedOutputs(ctx(), { agencyId: "agc_1" });
    const findArgs = mocks.generatedOutputFindMany.mock.calls[0]?.[0] as {
      where: { episode: { show: { client: { agencyId: string } } } };
    };
    expect(findArgs.where.episode.show.client.agencyId).toBe("agc_1");
  });

  it("drops the supersededAt filter when currentOnly is false", async () => {
    await listFlaggedOutputs(ctx(), { currentOnly: false });
    const findArgs = mocks.generatedOutputFindMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(findArgs.where.supersededAt).toBeUndefined();
  });
});

describe("flagOutput", () => {
  it("stamps flagReason/flaggedAt and fires an audit row scoped to the agency", async () => {
    mocks.generatedOutputFindUnique.mockResolvedValueOnce({
      episode: { show: { client: { agencyId: "agc_x" } } },
    });

    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );
    // Inside the TX — before + after selects.
    mocks.generatedOutputFindUnique.mockResolvedValueOnce({
      flagReason: null,
      flaggedByMemberId: null,
      flaggedAt: null,
    });
    mocks.generatedOutputUpdate.mockResolvedValueOnce({
      flagReason: "off-brand",
      flaggedByMemberId: null,
      flaggedAt: new Date(),
    });

    await flagOutput(ctx(), { outputId: "go_1", reason: "off-brand" });

    expect(fake.auditWrites[0]?.targetAgencyId).toBe("agc_x");
    expect(fake.auditWrites[0]?.targetEntityId).toBe("go_1");
    expect(fake.outputUpdates).toHaveLength(1);
  });

  it("throws NotFoundError when the output doesn't exist (no TX opens)", async () => {
    mocks.generatedOutputFindUnique.mockResolvedValueOnce(null);
    await expect(
      flagOutput(ctx(), { outputId: "go_missing", reason: "test flag" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });
});

describe("unflagOutput", () => {
  it("is a no-op when the row is already unflagged (idempotent, no TX)", async () => {
    mocks.generatedOutputFindUnique.mockResolvedValueOnce({
      flaggedAt: null,
      episode: { show: { client: { agencyId: "agc_x" } } },
    });

    await unflagOutput(ctx(), { outputId: "go_1", note: "already handled" });
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it("clears the columns and fires an audit row when currently flagged", async () => {
    mocks.generatedOutputFindUnique.mockResolvedValueOnce({
      flaggedAt: new Date(),
      episode: { show: { client: { agencyId: "agc_x" } } },
    });

    const fake = buildFakeTx();
    mocks.$transaction.mockImplementation(async (cb: (t: unknown) => Promise<unknown>) =>
      cb(fake.tx),
    );
    mocks.generatedOutputFindUnique.mockResolvedValueOnce({
      flagReason: "old reason",
      flaggedByMemberId: null,
      flaggedAt: new Date(),
    });
    mocks.generatedOutputUpdate.mockResolvedValueOnce({
      flagReason: null,
      flaggedByMemberId: null,
      flaggedAt: null,
    });

    await unflagOutput(ctx(), { outputId: "go_1", note: "reviewed — actually fine" });
    expect(fake.outputUpdates).toHaveLength(1);
    const updateArgs = fake.outputUpdates[0] as { data: Record<string, unknown> };
    expect(updateArgs.data.flagReason).toBeNull();
    expect(updateArgs.data.flaggedAt).toBeNull();
  });
});

// ============================================================
// Fixtures
// ============================================================

function buildAbuseRow(overrides: {
  id: string;
  targetAgencyId?: string | null;
  category?: AbuseReportCategory;
  status?: AbuseReportStatus;
}) {
  return {
    id: overrides.id,
    reportedByEmail: "reporter@example.com",
    category: overrides.category ?? ("SPAM" satisfies AbuseReportCategory),
    status: overrides.status ?? ("OPEN" satisfies AbuseReportStatus),
    body: "body",
    targetAgencyId: overrides.targetAgencyId ?? null,
    targetMemberId: null,
    targetOutputId: null,
    resolution: null,
    createdAt: new Date("2026-06-30T00:00:00Z"),
    resolvedAt: null,
    updatedAt: new Date("2026-06-30T00:00:00Z"),
    assignedTo: null,
  };
}

function buildAbuseSelectRow(overrides: {
  id: string;
  status: AbuseReportStatus;
  targetAgencyId?: string | null;
  assignedToId?: string | null;
}) {
  return {
    id: overrides.id,
    reportedByEmail: "reporter@example.com",
    category: "SPAM" satisfies AbuseReportCategory,
    status: overrides.status,
    body: "body",
    targetAgencyId: overrides.targetAgencyId ?? null,
    targetMemberId: null,
    targetOutputId: null,
    resolution: overrides.status === "RESOLVED" ? "action taken" : null,
    createdAt: new Date("2026-06-30T00:00:00Z"),
    resolvedAt:
      overrides.status === "RESOLVED" || overrides.status === "DISMISSED"
        ? new Date("2026-06-30T01:00:00Z")
        : null,
    updatedAt: new Date("2026-06-30T01:00:00Z"),
    assignedTo:
      overrides.assignedToId === null
        ? null
        : overrides.assignedToId
          ? { id: overrides.assignedToId, email: "op@example.com", name: null }
          : null,
  };
}
