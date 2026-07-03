/**
 * Phase 3.6.6 — impersonation cookie + chokepoint coverage.
 *
 * Tests live in two halves:
 *   1. Pure encode/decode + signing: round-trip, tampering, expiry, missing key.
 *   2. Read-only chokepoints: `requireRole`, `assertNotReadOnlyImpersonation`,
 *      and `assertRole` all throw when the context carries a read-only envelope.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberRole, Plan } from "@prisma/client";

// `@/server/auth/context` imports Clerk + `next/headers`, neither of which is
// available outside a Next request. Stub them out so the module loads in
// vitest; the impersonation chokepoints in `assertRole` are pure JS.
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  currentUser: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
  headers: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({
  prisma: {},
}));

import { ForbiddenError } from "@/server/auth/errors";
import { assertRole, type AuthContext } from "@/server/auth/context";
import {
  decodeImpersonationCookie,
  encodeImpersonationCookie,
  IMPERSONATION_TTL_MS,
  type ImpersonationPayload,
} from "@/server/auth/impersonation";
import {
  assertNotReadOnlyImpersonation,
  requireReadRole,
  requireRole,
  type TenantContext,
} from "@/server/auth/tenant";

const FIXED_KEY = "a".repeat(48); // > 32 bytes, distinct from any real-world value

function payload(overrides: Partial<ImpersonationPayload> = {}): ImpersonationPayload {
  return {
    systemAdminId: "sa_1",
    asMemberId: "mem_1",
    agencyId: "agency_1",
    mode: "read",
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("impersonation cookie — encode/decode round trip", () => {
  beforeEach(() => {
    process.env.IMPERSONATION_SIGNING_KEY = FIXED_KEY;
  });
  afterEach(() => {
    delete process.env.IMPERSONATION_SIGNING_KEY;
  });

  it("round-trips a valid payload", () => {
    const p = payload();
    const cookie = encodeImpersonationCookie(p);
    expect(cookie).not.toBeNull();
    const decoded = decodeImpersonationCookie(cookie!);
    expect(decoded).toEqual(p);
  });

  it("returns null when the signing key is missing", () => {
    delete process.env.IMPERSONATION_SIGNING_KEY;
    expect(encodeImpersonationCookie(payload())).toBeNull();
  });

  it("returns null when the signing key is shorter than 32 bytes", () => {
    process.env.IMPERSONATION_SIGNING_KEY = "short";
    expect(encodeImpersonationCookie(payload())).toBeNull();
  });

  it("rejects a tampered payload (mutated body, original signature)", () => {
    const cookie = encodeImpersonationCookie(payload({ asMemberId: "mem_1" }))!;
    const [, sig] = cookie.split(".");
    // Re-encode with a different memberId but keep the original signature.
    const evil = Buffer.from(JSON.stringify(payload({ asMemberId: "mem_evil" })))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeImpersonationCookie(`${evil}.${sig}`)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const cookie = encodeImpersonationCookie(payload())!;
    const [body] = cookie.split(".");
    expect(decodeImpersonationCookie(`${body}.deadbeef`)).toBeNull();
  });

  it("rejects an expired payload (startedAt older than TTL)", () => {
    const past = new Date(Date.now() - IMPERSONATION_TTL_MS - 1000).toISOString();
    const cookie = encodeImpersonationCookie(payload({ startedAt: past }))!;
    expect(decodeImpersonationCookie(cookie)).toBeNull();
  });

  it("rejects a payload with an invalid mode discriminator", async () => {
    // Hand-craft a payload with mode = "owner" (not a valid ImpersonationMode).
    const body = Buffer.from(JSON.stringify({ ...payload(), mode: "owner" }), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    // Mint a valid signature for the bad body — payload-validation must still
    // reject. This proves shape-checking sits AFTER signature verification.
    const { createHmac } = await import("node:crypto");
    const sig = createHmac("sha256", Buffer.from(FIXED_KEY, "utf8"))
      .update(body)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(decodeImpersonationCookie(`${body}.${sig}`)).toBeNull();
  });

  it("returns null on malformed cookie strings", () => {
    expect(decodeImpersonationCookie("")).toBeNull();
    expect(decodeImpersonationCookie("nope")).toBeNull();
    expect(decodeImpersonationCookie(".")).toBeNull();
    expect(decodeImpersonationCookie(".sig")).toBeNull();
    expect(decodeImpersonationCookie("body.")).toBeNull();
  });

  it("ignores cookie content when the signing key has rotated", () => {
    const cookie = encodeImpersonationCookie(payload())!;
    process.env.IMPERSONATION_SIGNING_KEY = "b".repeat(48);
    expect(decodeImpersonationCookie(cookie)).toBeNull();
  });
});

describe("read-only impersonation — chokepoints", () => {
  const tenantBase: TenantContext = { agencyId: "agency_1", role: MemberRole.OWNER };
  const readOnly = (over: Partial<TenantContext> = {}): TenantContext => ({
    ...tenantBase,
    ...over,
    impersonation: { systemAdminId: "sa_1", mode: "read" },
  });

  it("requireRole throws ForbiddenError even when the role is in the allowed list", () => {
    expect(() => requireRole(readOnly(), [MemberRole.OWNER])).toThrow(ForbiddenError);
  });

  it("requireRole still throws for write-mode impersonation only when the role is wrong (write isn't blocked here)", () => {
    const writeMode: TenantContext = {
      ...tenantBase,
      impersonation: { systemAdminId: "sa_1", mode: "write" },
    };
    // Write-mode impersonation does NOT block role-gated writes — that's the
    // whole point. The audit-row attribution happens at the action layer.
    expect(() => requireRole(writeMode, [MemberRole.OWNER])).not.toThrow();
  });

  it("requireRole runs normally without impersonation", () => {
    expect(() => requireRole(tenantBase, [MemberRole.OWNER])).not.toThrow();
    expect(() =>
      requireRole({ ...tenantBase, role: MemberRole.REVIEWER }, [MemberRole.OWNER]),
    ).toThrow(ForbiddenError);
  });

  it("assertNotReadOnlyImpersonation throws under read mode and passes otherwise", () => {
    expect(() => assertNotReadOnlyImpersonation(readOnly())).toThrow(ForbiddenError);
    expect(() => assertNotReadOnlyImpersonation(tenantBase)).not.toThrow();
    expect(() =>
      assertNotReadOnlyImpersonation({
        ...tenantBase,
        impersonation: { systemAdminId: "sa_1", mode: "write" },
      }),
    ).not.toThrow();
  });

  it("requireReadRole PASSES under read-only impersonation (reads must stay open)", () => {
    // Regression guard for the bug where an operator opened a read-only
    // envelope and then couldn't browse the tenant they were inside — the
    // topbar's `listClients` call was tripping `requireRole` on every render.
    expect(() => requireReadRole(readOnly(), [MemberRole.OWNER])).not.toThrow();
    // Still gates on role membership though — a REVIEWER cannot exercise a
    // ROLE-narrowed read helper.
    expect(() =>
      requireReadRole({ ...readOnly(), role: MemberRole.REVIEWER }, [MemberRole.OWNER]),
    ).toThrow(ForbiddenError);
  });

  it("requireReadRole runs the role check identically to requireRole otherwise", () => {
    expect(() => requireReadRole(tenantBase, [MemberRole.OWNER])).not.toThrow();
    expect(() =>
      requireReadRole({ ...tenantBase, role: MemberRole.REVIEWER }, [MemberRole.OWNER]),
    ).toThrow(ForbiddenError);
  });
});

describe("read-only impersonation — assertRole chokepoint (AuthContext layer)", () => {
  const baseAuth: AuthContext = {
    user: { clerkUserId: "user_1", email: "ops@example.com", name: null, imageUrl: null },
    agency: {
      id: "agency_1",
      name: "Test Agency",
      plan: Plan.STUDIO,
      stripeSubscriptionId: "sub_test",
      trialStatus: "NONE",
      trialEndsAt: null,
    },
    member: { id: "mem_1", role: MemberRole.OWNER },
    impersonation: null,
  };

  it("blocks otherwise-allowed roles when impersonating read-only", () => {
    const ctx: AuthContext = {
      ...baseAuth,
      impersonation: {
        systemAdminId: "sa_1",
        mode: "read",
        actorRole: "ROOT",
        actor: { email: "root@repodcast.com", name: "Root" },
        as: { email: "owner@tenant.com", name: "Tenant Owner" },
        startedAt: new Date().toISOString(),
      },
    };
    expect(() => assertRole(ctx, [MemberRole.OWNER])).toThrow(ForbiddenError);
  });

  it("passes role-gated writes without impersonation", () => {
    expect(() => assertRole(baseAuth, [MemberRole.OWNER])).not.toThrow();
  });
});
