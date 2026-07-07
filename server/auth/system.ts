import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { isClerkAPIResponseError } from "@clerk/shared/error";
import type { SystemAdminRole } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/server/db/client";

/** See `server/auth/context.ts:currentUserOrNullIfDeleted` for rationale. */
async function currentUserOrNullIfDeleted() {
  try {
    return await currentUser();
  } catch (err) {
    if (isClerkAPIResponseError(err) && err.status === 404) return null;
    throw err;
  }
}
import { ForbiddenError } from "./errors";

/**
 * Resolved identity for a Repodcast platform-employee request to `/root/*`.
 *
 * Note: this is intentionally NOT a superset of `AuthContext`. A SystemAdmin
 * may also be a `Member` of one or more agencies; the two contexts are looked
 * up independently and a route is either ROOT-scoped (uses this) or tenant-
 * scoped (uses `getAuthContext`), never both at once. The only crossover is
 * the impersonation envelope (Phase 3.6.6), where a SystemAdminContext is
 * resolved first and then USED to swap the resolved TenantContext — handled
 * inside `getAuthContext`, not here.
 */
export type SystemAdminContext = {
  user: {
    clerkUserId: string;
    email: string;
    name: string | null;
    imageUrl: string | null;
  };
  admin: {
    id: string;
    role: SystemAdminRole;
    mfaEnforced: boolean;
  };
};

/**
 * Resolve the current Clerk user against the `SystemAdmin` table. Returns
 * null when:
 *   - the request is unauthenticated,
 *   - the Clerk user has no SystemAdmin row, OR
 *   - the SystemAdmin row is soft-deleted (`deactivatedAt != null`).
 *
 * 404 vs 403: callers (route layouts, route handlers) treat `null` as **404
 * Not Found** rather than 403 Forbidden so the surface's existence doesn't
 * leak to non-admins probing `/root/*`. See `requireSystemAdminContext`.
 */
export async function getSystemAdminContext(): Promise<SystemAdminContext | null> {
  const { userId } = await auth();
  if (!userId) return null;

  // Clerk + DB lookups are independent — run them concurrently.
  const [user, admin] = await Promise.all([
    currentUserOrNullIfDeleted(),
    prisma.systemAdmin.findFirst({
      where: { clerkUserId: userId, deactivatedAt: null },
      select: { id: true, role: true, mfaEnforced: true },
    }),
  ]);

  console.log("getSystemAdminContext", { user, admin });

  if (!user || !admin) return null;

  return {
    user: {
      clerkUserId: userId,
      email: user.primaryEmailAddress?.emailAddress ?? "",
      name: [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || null,
      imageUrl: user.imageUrl ?? null,
    },
    admin,
  };
}

/**
 * Same as `getSystemAdminContext` but acts as a hard gate for server
 * components inside `/root/*`. Behaviour:
 *   1. Unauthenticated → redirect to `/sign-in?redirect_url=...`.
 *   2. Authenticated but no `SystemAdmin` row → `notFound()` (404). The
 *      surface should be invisible to non-admins; 403 would confirm `/root`
 *      exists.
 *
 * MFA enforcement (the `mfaEnforced` column on SystemAdmin) is currently a
 * no-op. The original design checked `session.sessionClaims.factors`, but
 * that is NOT a default Clerk JWT claim — surfacing it requires a custom
 * Clerk JWT template every install must configure, OR a per-request
 * `clerkClient.users.getUser(userId)` round-trip to read `twoFactorEnabled`.
 * The redirect target `/sign-in?reason=mfa_required` is also a dead end for
 * already-signed-in users (Clerk's <SignIn> bounces them to /), creating a
 * redirect loop. Wiring this correctly lands with the impersonation slice
 * (3.6.6 — write-mode impersonation is where MFA actually matters); for now
 * the schema field is reserved so the future check can flip it on without a
 * migration.
 *
 * Side-effect: best-effort `lastActiveAt` bump. Wrapped in catch so a DB
 * blip can never block the page render — the field is a hygiene signal, not
 * a load-bearing fact.
 */
export async function requireSystemAdminContext(opts?: {
  /** Override the redirect target when the user is unauthenticated. */
  signInRedirectTo?: string;
}): Promise<SystemAdminContext> {
  const { userId } = await auth();
  if (!userId) {
    redirect(`/sign-in?redirect_url=${encodeURIComponent(opts?.signInRedirectTo ?? "/root")}`);
  }

  const ctx = await getSystemAdminContext();
  if (!ctx) notFound();

  // Best-effort hygiene write. Never blocks; never throws.
  void prisma.systemAdmin
    .update({ where: { id: ctx.admin.id }, data: { lastActiveAt: new Date() } })
    .catch(() => undefined);

  return ctx;
}

/**
 * Assert the current SystemAdmin holds at least one of the allowed roles.
 * Throws `ForbiddenError` (statusCode 403) if not.
 *
 * Used INSIDE `/root/*` actions — by the time this runs, the surface has
 * already been gated by `requireSystemAdminContext`, so 403 is the right
 * code (the user IS allowed to see the surface, just not perform this
 * specific action).
 */
export function assertSystemRole(
  ctx: SystemAdminContext,
  allowed: readonly SystemAdminRole[],
): void {
  if (!allowed.includes(ctx.admin.role)) {
    throw new ForbiddenError(
      `SystemAdminRole ${ctx.admin.role} is not allowed (need one of: ${allowed.join(", ")})`,
    );
  }
}

/**
 * Convenience role bundles. ROOT is implicit in every bundle — the role
 * fans out from most-privileged to least.
 */
export const SYSTEM_WRITE_ROLES: readonly SystemAdminRole[] = ["ROOT", "OPERATOR"];
export const SYSTEM_ROOT_ONLY: readonly SystemAdminRole[] = ["ROOT"];
export const SYSTEM_READ_ROLES: readonly SystemAdminRole[] = [
  "ROOT",
  "OPERATOR",
  "SUPPORT",
  "ANALYST",
];
