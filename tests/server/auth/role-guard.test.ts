import { describe, expect, it } from "vitest";
import { MemberRole } from "@prisma/client";
import { ForbiddenError, NotFoundError, AppError } from "@/server/auth/errors";
import { requireRole, type TenantContext } from "@/server/auth/tenant";

const ctx = (role: MemberRole): TenantContext => ({ agencyId: "a1", role });

describe("requireRole", () => {
  it("passes when the role is in the allowed list", () => {
    expect(() => requireRole(ctx(MemberRole.OWNER), [MemberRole.OWNER])).not.toThrow();
    expect(() =>
      requireRole(ctx(MemberRole.EDITOR), [MemberRole.EDITOR, MemberRole.OWNER]),
    ).not.toThrow();
  });

  it("throws ForbiddenError when the role is not allowed", () => {
    expect(() => requireRole(ctx(MemberRole.REVIEWER), [MemberRole.OWNER])).toThrow(ForbiddenError);
  });

  it("ForbiddenError carries statusCode=403", () => {
    try {
      requireRole(ctx(MemberRole.EDITOR), [MemberRole.OWNER]);
      throw new Error("requireRole should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
      expect((err as ForbiddenError).statusCode).toBe(403);
    }
  });

  it("disallowed for an empty allowed list", () => {
    expect(() => requireRole(ctx(MemberRole.OWNER), [])).toThrow(ForbiddenError);
  });
});

describe("error class hierarchy", () => {
  it("ForbiddenError and NotFoundError extend AppError", () => {
    expect(new ForbiddenError()).toBeInstanceOf(AppError);
    expect(new NotFoundError()).toBeInstanceOf(AppError);
  });

  it("NotFoundError carries statusCode=404", () => {
    expect(new NotFoundError().statusCode).toBe(404);
  });
});
