import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import { isClerkAPIResponseError } from "@clerk/shared/error";
import type { MemberRole, Plan, SystemAdminRole, TrialStatus } from "@prisma/client";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { hasActiveAccess } from "@/server/billing/limits";
import { ForbiddenError } from "./errors";
import { readImpersonationPayload, type ImpersonationMode } from "./impersonation";

/**
 * `currentUser()` variant that tolerates a stale session — the JWT
 * cookie can outlive the Clerk user (self-delete via UserProfile,
 * `deleteWorkspaceAction` deletes the user at the end, admin removes
 * user via ROOT). When that happens, `auth()` still returns the
 * `userId` decoded from the cookie but the users API responds 404.
 * Treat that as "not signed in" so the caller redirects to sign-in
 * on the next navigation instead of crashing the render.
 *
 * We only swallow the 404 — a Clerk outage (5xx) or auth error
 * should surface loudly.
 */
async function currentUserOrNullIfDeleted() {
  try {
    return await currentUser();
  } catch (err) {
    if (isClerkAPIResponseError(err) && err.status === 404) return null;
    throw err;
  }
}

export type AuthContext = {
  user: {
    clerkUserId: string;
    email: string;
    name: string | null;
    imageUrl: string | null;
  };
  agency: {
    id: string;
    name: string;
    plan: Plan;
    /**
     * Present when the agency has an active (or once-active) Stripe sub.
     * Used by the dashboard gate to enforce the paid-only onboarding flow —
     * unpaid agencies get bounced to /onboarding.
     */
    stripeSubscriptionId: string | null;
    /**
     * ROOT-granted free-access window. Non-null AND in the future = the
     * agency clears the "has active subscription" gate without a Stripe sub.
     * Surfaced on the auth context so the dashboard layout can decide with
     * one call instead of a second DB round-trip. See `hasActiveAccess`.
     */
    compAccessExpiresAt: Date | null;
    /**
     * Phase 3.9 — trial state, surfaced here so the dashboard shell can
     * render the "X days left" banner without a second lookup. `trialEndsAt`
     * is null on agencies that never trialed; `trialStatus` is always set.
     */
    trialStatus: TrialStatus;
    trialEndsAt: Date | null;
  };
  member: {
    id: string;
    role: MemberRole;
  };
  /**
   * Set when a SystemAdmin is acting as `member` via the impersonation
   * envelope (Phase 3.6.6). The tenant repo layer treats this as a
   * read-only context — every `requireRole` call throws.
   */
  impersonation: {
    systemAdminId: string;
    mode: ImpersonationMode;
    /**
     * Role of the SystemAdmin who opened the envelope. Surfaced so the
     * tenant chrome can render ROOT-only affordances (e.g. the
     * "Promote to WRITE" button on the banner) without a re-lookup.
     */
    actorRole: SystemAdminRole;
    /** Original SystemAdmin display fields — for audit + admin chrome. */
    actor: { email: string; name: string | null };
    /** Impersonated Member display fields — surfaced by the orange banner. */
    as: { email: string; name: string | null };
    /** ISO string. Used for the "started X minutes ago" banner copy + expiry display. */
    startedAt: string;
  } | null;
};

/**
 * Resolve the current Clerk user + active agency + matching Member from the
 * DB. Returns null when the request is unauthenticated OR the user hasn't
 * been onboarded yet (no Member rows for any agency).
 *
 * Agency creation is now in-app (Phase 1.0 — `createAgencyAction`), so the
 * lookup is keyed on Clerk's `userId` + the user's `Member` rows — not on
 * Clerk's `orgId`. This unblocks self-serve signups: users land on
 * /onboarding the moment they sign in without a Member, regardless of
 * whether they've ever touched Clerk's Organization UI.
 *
 * Multi-agency users: the most-recently-touched Member wins. A proper
 * cookie-backed agency switcher is a follow-up after 1.0.
 *
 * Phase 3.6.6 — when a valid `repodcast_impersonate` cookie is present AND
 * the signing user resolves to an active SystemAdmin row, the resolved
 * `agency` + `member` are swapped to the impersonated pair. The original
 * SystemAdmin identity is surfaced via the `impersonation` field so the
 * tenant chrome can render the banner; `user` still points at the SystemAdmin's
 * Clerk profile (we never lie about who's actually clicking).
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const { userId } = await auth();
  if (!userId) return null;

  // Read the impersonation envelope before anything else so we know which
  // Member row to resolve. The cookie is verified inside the helper; tampered
  // / expired cookies come back as null.
  const impersonation = await readImpersonationPayload();

  if (impersonation) {
    const swapped = await resolveImpersonatedContext(userId, impersonation);
    if (swapped) return swapped;
    // Fall through to the normal tenant lookup — a stale envelope (admin
    // deactivated, target member deleted) is treated as "no impersonation",
    // which is the same as if the cookie had expired.
  }

  // Run Clerk + DB lookups concurrently — they're independent.
  //
  // Multi-agency users: we prefer the OWNER membership first (users get
  // *their* workspace, not one they were invited to), then fall back to
  // most-recently-updated so recent activity still wins for peers-only
  // memberships. This matches `getOnboardingStateForUser` in
  // `server/db/agencies.ts`; drift between the two caused Bug 1 (an
  // active-subscription client bounced to /onboarding because
  // getOnboardingStateForUser returned the older non-paying agency
  // while this function returned the paying one, tripping the
  // stripeSubscriptionId gate in the layout). Both functions must
  // resolve to the SAME row.
  const [user, member] = await Promise.all([
    currentUserOrNullIfDeleted(),
    prisma.member.findFirst({
      where: { clerkUserId: userId },
      orderBy: [{ role: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        role: true,
        agency: {
          select: {
            id: true,
            name: true,
            plan: true,
            stripeSubscriptionId: true,
            compAccessExpiresAt: true,
            trialStatus: true,
            trialEndsAt: true,
          },
        },
      },
    }),
  ]);

  if (!user || !member) return null;

  return {
    user: {
      clerkUserId: userId,
      email: user.primaryEmailAddress?.emailAddress ?? "",
      name: [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || null,
      imageUrl: user.imageUrl ?? null,
    },
    agency: {
      id: member.agency.id,
      name: member.agency.name,
      plan: member.agency.plan,
      stripeSubscriptionId: member.agency.stripeSubscriptionId,
      compAccessExpiresAt: member.agency.compAccessExpiresAt,
      trialStatus: member.agency.trialStatus,
      trialEndsAt: member.agency.trialEndsAt,
    },
    member: {
      id: member.id,
      role: member.role,
    },
    impersonation: null,
  };
}

async function resolveImpersonatedContext(
  clerkUserId: string,
  payload: Awaited<ReturnType<typeof readImpersonationPayload>>,
): Promise<AuthContext | null> {
  if (!payload) return null;

  // Resolve everything in parallel — the four lookups are independent.
  const [user, admin, impersonatedMember] = await Promise.all([
    currentUser(),
    prisma.systemAdmin.findFirst({
      where: { id: payload.systemAdminId, clerkUserId, deactivatedAt: null },
      select: { id: true, email: true, name: true, role: true },
    }),
    prisma.member.findUnique({
      where: { id: payload.asMemberId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        agencyId: true,
        agency: {
          select: {
            id: true,
            name: true,
            plan: true,
            stripeSubscriptionId: true,
            compAccessExpiresAt: true,
            trialStatus: true,
            trialEndsAt: true,
          },
        },
      },
    }),
  ]);

  // Defensive: cookie has to match a real SystemAdmin row owned by THIS
  // Clerk user. If the admin was deactivated since the cookie was minted,
  // or the target member was deleted, or the cookie's agencyId no longer
  // matches the member's agency, the envelope is invalid.
  if (!user || !admin) return null;
  if (!impersonatedMember || impersonatedMember.agencyId !== payload.agencyId) return null;

  return {
    user: {
      clerkUserId,
      email: user.primaryEmailAddress?.emailAddress ?? "",
      name: [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || null,
      imageUrl: user.imageUrl ?? null,
    },
    agency: {
      id: impersonatedMember.agency.id,
      name: impersonatedMember.agency.name,
      plan: impersonatedMember.agency.plan,
      stripeSubscriptionId: impersonatedMember.agency.stripeSubscriptionId,
      compAccessExpiresAt: impersonatedMember.agency.compAccessExpiresAt,
      trialStatus: impersonatedMember.agency.trialStatus,
      trialEndsAt: impersonatedMember.agency.trialEndsAt,
    },
    member: {
      id: impersonatedMember.id,
      role: impersonatedMember.role,
    },
    impersonation: {
      systemAdminId: admin.id,
      mode: payload.mode,
      actorRole: admin.role,
      actor: { email: admin.email, name: admin.name },
      as: { email: impersonatedMember.email, name: impersonatedMember.name },
      startedAt: payload.startedAt,
    },
  };
}

/**
 * Same as `getAuthContext` but redirects unauthenticated callers to the
 * sign-in page. Use this for server components inside protected routes.
 */
export async function requireAuthContext(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/sign-in");
  return ctx;
}

/**
 * Assert the current member has at least one of the allowed roles. Throws a
 * `ForbiddenError` (statusCode 403) if the check fails. Pair with
 * `requireAuthContext` for protected routes.
 *
 * Read-only impersonation: blocked here as a defense-in-depth measure even
 * before the call reaches a repo helper. Matches the rule enforced in
 * `requireRole` at the tenant layer.
 */
export function assertRole(ctx: AuthContext, allowed: readonly MemberRole[]): void {
  if (ctx.impersonation?.mode === "read") {
    throw new ForbiddenError(
      "Writes are disabled while impersonating in read-only mode. End the impersonation to act as yourself.",
    );
  }
  if (!allowed.includes(ctx.member.role)) {
    throw new ForbiddenError(
      `Role ${ctx.member.role} is not allowed (need one of: ${allowed.join(", ")})`,
    );
  }
}

/**
 * Refuse write actions when the agency has no live access — a Stripe
 * subscription OR a ROOT-granted comp window that hasn't expired yet.
 * Canceled subs land here (the webhook nulls `stripeSubscriptionId` on
 * `customer.subscription.deleted`); trialing subs still count as live
 * (Stripe issues a subscription id at trial start), so this doesn't
 * block the free-trial flow.
 *
 * Placed alongside `assertRole` so create/mutate server actions can
 * gate in one call before touching the DB. The dashboard layout also
 * bounces canceled users to `/settings/billing`, but layouts don't run
 * for server-action POSTs — the form the user submitted might have
 * been open when Stripe canceled the sub, and without this gate the
 * write would still succeed and then bounce the user to Billing on
 * the redirect.
 */
export function assertActiveSubscription(ctx: AuthContext): void {
  if (!hasActiveAccess(ctx.agency)) {
    throw new ForbiddenError(
      "Your subscription isn't active. Resume it (or pick a plan) in Settings → Billing before creating new content.",
    );
  }
}
