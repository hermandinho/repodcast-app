/**
 * Anti-fraud signals + public abuse-report intake.
 *
 * Covers:
 *   - `ownerEmailDomain` normalizes + lowercases + rejects malformed inputs
 *   - `listFraudSignalCandidates` fires each signal correctly and skips
 *     agencies that don't fire any
 *   - Multi-agency-same-owner dedupes correctly when the same clerkUserId
 *     owns 3+ agencies
 *   - Sort order is signal-count desc → spend desc → newest first
 *   - Read gate: every system read role can call; not-a-role rejects
 *   - `submitPublicAbuseReport` persists an OPEN row with the honeypot-
 *     equivalent body-shape (no admin actor, no audit row)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemAdminRole } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  memberFindMany: vi.fn(),
  usageLogGroupBy: vi.fn(),
  abuseReportCreate: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    member: { findMany: mocks.memberFindMany },
    usageLog: { groupBy: mocks.usageLogGroupBy },
    abuseReport: { create: mocks.abuseReportCreate },
  },
}));

import type { SystemAdminContext } from "@/server/auth/system";
import { ForbiddenError } from "@/server/auth/errors";
import {
  listFraudSignalCandidates,
  ownerEmailDomain,
  submitPublicAbuseReport,
} from "@/server/db/system/quality";

function ctx(role: SystemAdminRole = "ROOT"): SystemAdminContext {
  return {
    user: { clerkUserId: "user_1", email: "ops@example.com", name: null, imageUrl: null },
    admin: { id: "sa_1", role, mfaEnforced: true },
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.memberFindMany.mockResolvedValue([]);
  mocks.usageLogGroupBy.mockResolvedValue([]);
});

describe("ownerEmailDomain", () => {
  it("extracts + lowercases the domain", () => {
    expect(ownerEmailDomain("Alice@Example.COM")).toBe("example.com");
  });
  it("returns null on null or malformed inputs", () => {
    expect(ownerEmailDomain(null)).toBeNull();
    expect(ownerEmailDomain("")).toBeNull();
    expect(ownerEmailDomain("not-an-email")).toBeNull();
    expect(ownerEmailDomain("trailing@")).toBeNull();
  });
  it("trims surrounding whitespace on the domain half", () => {
    expect(ownerEmailDomain("bob@ example.com ")).toBe("example.com");
  });
});

describe("listFraudSignalCandidates", () => {
  it("rejects a caller with no system role", async () => {
    const invalid = {
      admin: { id: "x", role: "NOT_A_ROLE" as SystemAdminRole, mfaEnforced: true },
    } as unknown as SystemAdminContext;
    await expect(listFraudSignalCandidates(invalid)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("fires young_high_spend_no_sub only when all three conditions hold", async () => {
    const now = Date.now();
    // Agency 1: young (2 days), high spend ($100), no sub → fires.
    // Agency 2: young + high spend but HAS sub → skipped.
    // Agency 3: old (14 days) + high spend + no sub → skipped (too old).
    // Agency 4: young + low spend + no sub → skipped (spend too low).
    mocks.memberFindMany.mockResolvedValue([
      makeOwner("m1", "u1", "a1", "alice@example.com", "Alice", new Date(now - 2 * DAY_MS), null),
      makeOwner("m2", "u2", "a2", "bob@example.com", "Bob", new Date(now - 2 * DAY_MS), "sub_1"),
      makeOwner("m3", "u3", "a3", "carol@example.com", "Carol", new Date(now - 14 * DAY_MS), null),
      makeOwner("m4", "u4", "a4", "dave@example.com", "Dave", new Date(now - 1 * DAY_MS), null),
    ]);
    mocks.usageLogGroupBy.mockResolvedValue([
      { agencyId: "a1", _sum: { costCents: 10_000 } }, // $100
      { agencyId: "a2", _sum: { costCents: 10_000 } },
      { agencyId: "a3", _sum: { costCents: 10_000 } },
      { agencyId: "a4", _sum: { costCents: 100 } }, // $1
    ]);

    const rows = await listFraudSignalCandidates(ctx());

    const byId = new Map(rows.map((r) => [r.agencyId, r]));
    expect(byId.get("a1")?.signals).toContain("young_high_spend_no_sub");
    expect(byId.get("a2")).toBeUndefined(); // has sub → no signal fired
    expect(byId.get("a3")).toBeUndefined(); // too old
    expect(byId.get("a4")).toBeUndefined(); // too little spend
  });

  it("fires disposable_email for known disposable domains regardless of spend", async () => {
    mocks.memberFindMany.mockResolvedValue([
      makeOwner(
        "m1",
        "u1",
        "a1",
        "throwaway@mailinator.com",
        "Anon",
        new Date(Date.now() - 30 * DAY_MS),
        "sub_1",
      ),
    ]);
    const rows = await listFraudSignalCandidates(ctx());
    expect(rows).toHaveLength(1);
    expect(rows[0].signals).toEqual(["disposable_email"]);
  });

  it("fires multi_agency_same_owner and populates siblingAgencyIds correctly", async () => {
    // Same clerkUserId on three agencies → each row lists the other two.
    mocks.memberFindMany.mockResolvedValue([
      makeOwner("m1", "u_shared", "a1", "op@corp.com", "Op", new Date(), "sub_1"),
      makeOwner("m2", "u_shared", "a2", "op@corp.com", "Op", new Date(), "sub_2"),
      makeOwner("m3", "u_shared", "a3", "op@corp.com", "Op", new Date(), "sub_3"),
      // Unrelated single-agency owner — should NOT fire.
      makeOwner("m4", "u_solo", "a4", "solo@corp.com", "Solo", new Date(), "sub_4"),
    ]);
    const rows = await listFraudSignalCandidates(ctx());
    const byId = new Map(rows.map((r) => [r.agencyId, r]));
    const sortedSiblings = (id: string) => [...(byId.get(id)?.siblingAgencyIds ?? [])].sort();
    expect(sortedSiblings("a1")).toEqual(["a2", "a3"]);
    expect(sortedSiblings("a2")).toEqual(["a1", "a3"]);
    expect(sortedSiblings("a3")).toEqual(["a1", "a2"]);
    expect(byId.get("a4")).toBeUndefined(); // unrelated owner not flagged
  });

  it("skips agencies with zero signals", async () => {
    mocks.memberFindMany.mockResolvedValue([
      makeOwner("m1", "u1", "a1", "clean@bigco.com", "Clean", new Date(), "sub_1"),
    ]);
    const rows = await listFraudSignalCandidates(ctx());
    expect(rows).toHaveLength(0);
  });

  it("sorts by signal-count desc, then spend desc, then newest first", async () => {
    const now = Date.now();
    mocks.memberFindMany.mockResolvedValue([
      // a1: 2 signals (young+high+nosub) + disposable email = 2 signals
      makeOwner("m1", "u1", "a1", "x@mailinator.com", "One", new Date(now - 1 * DAY_MS), null),
      // a2: 1 signal (young+high+nosub) + $200 spend
      makeOwner("m2", "u2", "a2", "clean@bigco.com", "Two", new Date(now - 2 * DAY_MS), null),
      // a3: 1 signal (young+high+nosub) + $100 spend
      makeOwner("m3", "u3", "a3", "clean@bigco.com", "Three", new Date(now - 3 * DAY_MS), null),
    ]);
    mocks.usageLogGroupBy.mockResolvedValue([
      { agencyId: "a1", _sum: { costCents: 10_000 } },
      { agencyId: "a2", _sum: { costCents: 20_000 } },
      { agencyId: "a3", _sum: { costCents: 10_000 } },
    ]);
    const rows = await listFraudSignalCandidates(ctx());
    expect(rows.map((r) => r.agencyId)).toEqual(["a1", "a2", "a3"]);
    // a1 first (2 signals) > a2 (1 signal, higher spend) > a3 (1 signal, lower spend).
  });

  it("returns 0 spend for agencies not present in usageLog groupBy", async () => {
    mocks.memberFindMany.mockResolvedValue([
      makeOwner("m1", "u1", "a1", "throw@mailinator.com", "One", new Date(), "sub_1"),
    ]);
    mocks.usageLogGroupBy.mockResolvedValue([]); // nobody has any usage
    const rows = await listFraudSignalCandidates(ctx());
    expect(rows[0].aiSpendCentsMtd).toBe(0);
  });
});

describe("submitPublicAbuseReport", () => {
  it("creates an OPEN row with combined body when targetHint is provided", async () => {
    mocks.abuseReportCreate.mockResolvedValue({ id: "abuse_1" });
    const result = await submitPublicAbuseReport({
      reportedByEmail: "reporter@example.com",
      category: "COPYRIGHT",
      body: "someone reposted my content without attribution here",
      targetHint: "https://twitter.com/badactor/status/123",
    });
    expect(result).toEqual({ id: "abuse_1" });
    const args = mocks.abuseReportCreate.mock.calls[0][0];
    expect(args.data.status).toBe("OPEN");
    expect(args.data.category).toBe("COPYRIGHT");
    expect(args.data.reportedByEmail).toBe("reporter@example.com");
    expect(args.data.body).toContain("someone reposted my content");
    expect(args.data.body).toContain("target hint");
    expect(args.data.body).toContain("https://twitter.com/badactor/status/123");
    // No admin actor + no audit row inserted here — public path skips
    // withSystemAudit entirely.
  });

  it("drops empty targetHint from the persisted body", async () => {
    mocks.abuseReportCreate.mockResolvedValue({ id: "abuse_2" });
    await submitPublicAbuseReport({
      category: "SPAM",
      body: "bulk sign-up spam via disposable email domains",
    });
    const args = mocks.abuseReportCreate.mock.calls[0][0];
    expect(args.data.body).not.toContain("target hint");
    expect(args.data.reportedByEmail).toBeNull();
  });

  it("rejects a body shorter than 20 characters", async () => {
    await expect(
      submitPublicAbuseReport({ category: "OTHER", body: "too short" }),
    ).rejects.toThrow();
    expect(mocks.abuseReportCreate).not.toHaveBeenCalled();
  });

  it("rejects an invalid email", async () => {
    await expect(
      submitPublicAbuseReport({
        category: "OTHER",
        body: "a body of at least twenty characters here",
        reportedByEmail: "not-an-email",
      }),
    ).rejects.toThrow();
  });

  it("treats an empty-string reportedByEmail as null", async () => {
    mocks.abuseReportCreate.mockResolvedValue({ id: "abuse_3" });
    // Empty string passes zod's `.or(z.literal("").transform(() => undefined))`
    // — the form action forwards a raw FormDataEntryValue that lands as "" when
    // the user didn't type an email.
    await submitPublicAbuseReport({
      category: "OTHER",
      body: "twenty-plus character description of the abuse being reported",
      reportedByEmail: "",
    });
    const args = mocks.abuseReportCreate.mock.calls[0][0];
    expect(args.data.reportedByEmail).toBeNull();
  });
});

// ============================================================
// Test helpers
// ============================================================

function makeOwner(
  memberId: string,
  clerkUserId: string,
  agencyId: string,
  email: string,
  name: string | null,
  createdAt: Date,
  stripeSubscriptionId: string | null,
) {
  return {
    id: memberId,
    clerkUserId,
    email,
    name,
    agencyId,
    agency: {
      id: agencyId,
      name: `Agency ${agencyId}`,
      plan: "STUDIO",
      createdAt,
      stripeSubscriptionId,
    },
  };
}
