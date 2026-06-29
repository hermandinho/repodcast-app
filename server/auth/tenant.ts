import type { MemberRole } from "@prisma/client";
import { ForbiddenError } from "./errors";
import type { AuthContext } from "./context";

/**
 * The minimum slice of authentication needed for tenant-scoped repository
 * helpers. Decoupling from the full AuthContext (which carries Clerk user
 * details) keeps repos easy to unit-test with synthetic contexts.
 */
export type TenantContext = {
  agencyId: string;
  role: MemberRole;
};

export function toTenantContext(auth: AuthContext): TenantContext {
  return { agencyId: auth.agency.id, role: auth.member.role };
}

/**
 * Throw ForbiddenError if the current member's role isn't in `allowed`.
 * Repositories call this at the top of mutation helpers so role checks
 * survive even when callers forget to gate at the route level.
 */
export function requireRole(ctx: TenantContext, allowed: readonly MemberRole[]): void {
  if (!allowed.includes(ctx.role)) {
    throw new ForbiddenError(
      `Role ${ctx.role} is not allowed (need one of: ${allowed.join(", ")})`,
    );
  }
}
