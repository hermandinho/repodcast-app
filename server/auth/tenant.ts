import type { MemberRole } from "@prisma/client";
import { ForbiddenError } from "./errors";
import type { AuthContext } from "./context";
import type { ImpersonationMode } from "./impersonation";

/**
 * The minimum slice of authentication needed for tenant-scoped repository
 * helpers. Decoupling from the full AuthContext (which carries Clerk user
 * details) keeps repos easy to unit-test with synthetic contexts.
 *
 * `impersonation` is set when the caller is a SystemAdmin acting as the
 * resolved member via the impersonation envelope. Repositories don't need to
 * branch on it — `requireRole` enforces the read-only rule centrally.
 */
export type TenantContext = {
  agencyId: string;
  role: MemberRole;
  impersonation?: {
    systemAdminId: string;
    mode: ImpersonationMode;
  } | null;
};

export function toTenantContext(auth: AuthContext): TenantContext {
  return {
    agencyId: auth.agency.id,
    role: auth.member.role,
    impersonation: auth.impersonation
      ? { systemAdminId: auth.impersonation.systemAdminId, mode: auth.impersonation.mode }
      : null,
  };
}

/**
 * Throw ForbiddenError if the current member's role isn't in `allowed`,
 * OR if the request is running under a read-only impersonation envelope.
 * Repositories call this at the top of MUTATION helpers so the read-only
 * rule survives even when callers forget the dedicated assert.
 *
 * Read helpers should use `requireReadRole` instead — otherwise an operator
 * doing read-only impersonation can't even browse the tenant they're inside.
 */
export function requireRole(ctx: TenantContext, allowed: readonly MemberRole[]): void {
  if (ctx.impersonation?.mode === "read") {
    throw new ForbiddenError(
      "Writes are disabled while impersonating in read-only mode. End the impersonation to act as yourself.",
    );
  }
  if (!allowed.includes(ctx.role)) {
    throw new ForbiddenError(
      `Role ${ctx.role} is not allowed (need one of: ${allowed.join(", ")})`,
    );
  }
}

/**
 * Role check for READ helpers. Same shape as `requireRole` but WITHOUT the
 * read-mode-impersonation guard — a SystemAdmin acting as a Member via the
 * read-only envelope needs to be able to browse the tenant, otherwise the
 * whole read-only mode is useless.
 *
 * Reads don't need any extra impersonation guard: the resolved
 * `TenantContext` carries the impersonated Member's real role, so an
 * impersonated REVIEWER sees exactly what a REVIEWER sees. Writes remain
 * gated by `requireRole` above.
 */
export function requireReadRole(ctx: TenantContext, allowed: readonly MemberRole[]): void {
  if (!allowed.includes(ctx.role)) {
    throw new ForbiddenError(
      `Role ${ctx.role} is not allowed (need one of: ${allowed.join(", ")})`,
    );
  }
}

/**
 * Explicit guard for action-layer code that mutates state without going
 * through a `requireRole`-gated repo helper. Paired with `requireRole` as
 * a defense-in-depth measure for the impersonation envelope.
 */
export function assertNotReadOnlyImpersonation(ctx: TenantContext): void {
  if (ctx.impersonation?.mode === "read") {
    throw new ForbiddenError(
      "Writes are disabled while impersonating in read-only mode. End the impersonation to act as yourself.",
    );
  }
}
