import { describe, expect, it } from "vitest";
import type { SystemAdminRole } from "@prisma/client";
import { ForbiddenError } from "@/server/auth/errors";
import {
  assertSystemRole,
  SYSTEM_READ_ROLES,
  SYSTEM_ROOT_ONLY,
  SYSTEM_WRITE_ROLES,
  type SystemAdminContext,
} from "@/server/auth/system";

function ctx(role: SystemAdminRole): SystemAdminContext {
  return {
    user: { clerkUserId: "user_test", email: "ops@example.com", name: null, imageUrl: null },
    admin: { id: "sa_1", role, mfaEnforced: true },
  };
}

describe("assertSystemRole", () => {
  it("passes when the role is in the allowed list", () => {
    expect(() => assertSystemRole(ctx("ROOT"), SYSTEM_ROOT_ONLY)).not.toThrow();
    expect(() => assertSystemRole(ctx("OPERATOR"), SYSTEM_WRITE_ROLES)).not.toThrow();
    expect(() => assertSystemRole(ctx("ANALYST"), SYSTEM_READ_ROLES)).not.toThrow();
  });

  it("throws ForbiddenError when the role is not in the allowed list", () => {
    expect(() => assertSystemRole(ctx("OPERATOR"), SYSTEM_ROOT_ONLY)).toThrow(ForbiddenError);
    expect(() => assertSystemRole(ctx("SUPPORT"), SYSTEM_WRITE_ROLES)).toThrow(ForbiddenError);
    expect(() => assertSystemRole(ctx("ANALYST"), SYSTEM_WRITE_ROLES)).toThrow(ForbiddenError);
  });

  it("ForbiddenError carries statusCode 403 and a useful message", () => {
    try {
      assertSystemRole(ctx("ANALYST"), SYSTEM_ROOT_ONLY);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      const fe = err as ForbiddenError;
      expect(fe.statusCode).toBe(403);
      expect(fe.message).toContain("ANALYST");
      expect(fe.message).toContain("ROOT");
    }
  });

  it("disallows any role when the allowed list is empty", () => {
    expect(() => assertSystemRole(ctx("ROOT"), [])).toThrow(ForbiddenError);
  });

  it("SYSTEM_READ_ROLES is a superset of SYSTEM_WRITE_ROLES is a superset of SYSTEM_ROOT_ONLY", () => {
    // Topology check: a ROOT user can do everything; an OPERATOR can write
    // but not ROOT-only; an ANALYST is read-only. Catches accidental
    // bundle-membership drift if someone edits the const exports.
    for (const r of SYSTEM_WRITE_ROLES) expect(SYSTEM_READ_ROLES).toContain(r);
    for (const r of SYSTEM_ROOT_ONLY) expect(SYSTEM_WRITE_ROLES).toContain(r);
  });

  it("full role-gate matrix (4 roles × 3 bundles) matches the documented authority order", () => {
    // Single table-driven assertion that ROOT-only is exclusive, write-roles
    // include OPERATOR but not SUPPORT/ANALYST, and read-roles include all four.
    const matrix: Array<{
      role: SystemAdminRole;
      bundle: readonly SystemAdminRole[];
      allowed: boolean;
    }> = [
      { role: "ROOT", bundle: SYSTEM_ROOT_ONLY, allowed: true },
      { role: "OPERATOR", bundle: SYSTEM_ROOT_ONLY, allowed: false },
      { role: "SUPPORT", bundle: SYSTEM_ROOT_ONLY, allowed: false },
      { role: "ANALYST", bundle: SYSTEM_ROOT_ONLY, allowed: false },

      { role: "ROOT", bundle: SYSTEM_WRITE_ROLES, allowed: true },
      { role: "OPERATOR", bundle: SYSTEM_WRITE_ROLES, allowed: true },
      { role: "SUPPORT", bundle: SYSTEM_WRITE_ROLES, allowed: false },
      { role: "ANALYST", bundle: SYSTEM_WRITE_ROLES, allowed: false },

      { role: "ROOT", bundle: SYSTEM_READ_ROLES, allowed: true },
      { role: "OPERATOR", bundle: SYSTEM_READ_ROLES, allowed: true },
      { role: "SUPPORT", bundle: SYSTEM_READ_ROLES, allowed: true },
      { role: "ANALYST", bundle: SYSTEM_READ_ROLES, allowed: true },
    ];

    for (const { role, bundle, allowed } of matrix) {
      if (allowed) {
        expect(() => assertSystemRole(ctx(role), bundle)).not.toThrow();
      } else {
        expect(() => assertSystemRole(ctx(role), bundle)).toThrow(ForbiddenError);
      }
    }
  });
});
