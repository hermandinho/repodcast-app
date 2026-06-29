import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";
import type { MemberRole, Plan } from "@prisma/client";
import { redirect } from "next/navigation";
import { prisma } from "@/server/db/client";
import { ForbiddenError } from "./errors";

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
  };
  member: {
    id: string;
    role: MemberRole;
  };
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
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const { userId } = await auth();
  if (!userId) return null;

  // Run Clerk + DB lookups concurrently — they're independent.
  const [user, member] = await Promise.all([
    currentUser(),
    prisma.member.findFirst({
      where: { clerkUserId: userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        role: true,
        agency: {
          select: { id: true, name: true, plan: true },
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
    },
    member: {
      id: member.id,
      role: member.role,
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
 */
export function assertRole(ctx: AuthContext, allowed: readonly MemberRole[]): void {
  if (!allowed.includes(ctx.member.role)) {
    throw new ForbiddenError(
      `Role ${ctx.member.role} is not allowed (need one of: ${allowed.join(", ")})`,
    );
  }
}
