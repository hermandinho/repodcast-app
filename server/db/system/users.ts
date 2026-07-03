import "server-only";

import { clerkClient } from "@clerk/nextjs/server";
import { type MemberRole, type Plan, type Prisma } from "@prisma/client";
import { z } from "zod";
import { NotFoundError } from "@/server/auth/errors";
import { prisma } from "@/server/db/client";
import { assertSystemRole, SYSTEM_READ_ROLES, type SystemAdminContext } from "@/server/auth/system";

/**
 * Phase 3.6.9 — cross-agency user search.
 *
 * The `Member` table is scoped per-agency (a Clerk user with N agency
 * memberships has N Member rows, one per agency, all sharing a `clerkUserId`).
 * This helper flips that: given a substring search, return one row per
 * distinct `clerkUserId` and carry the full list of agency memberships on
 * each row.
 *
 * v1 shape (DB-only):
 *   - substring search on email / name (case-insensitive)
 *   - exact match on `clerkUserId` (so an operator can paste `user_…` from
 *     Clerk directly)
 *   - per-row: identity + [{ agencyId, agencyName, role, joinedAt, lastActiveAt }]
 *   - ordered by "most recently active membership DESC" — the Member row's
 *     `updatedAt` is the closest proxy without touching Clerk
 *
 * Deferred (blocked on external calls or write actions):
 *   - Clerk last-sign-in / MFA state / disabled state (needs
 *     `clerkClient.users.getUser` per profile — round-trip we don't want
 *     inside the list query)
 *   - Support actions (resend welcome, reset password) — write side,
 *     lands with the support-actions slice
 *
 * Empty search is a no-op: the caller passes no `search`, we return zero
 * rows. Prevents accidental "download every member row" traffic.
 */

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;

export const searchMembersForRootInput = z.object({
  /**
   * Substring on email/name, or exact `user_…` clerkUserId. Whitespace is
   * trimmed; a trim-to-empty string collapses to `undefined` so the caller
   * doesn't have to guard against the page passing `"   "` down.
   */
  search: z
    .string()
    .trim()
    .max(160)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  skip: z.coerce.number().int().min(0).default(0),
});
export type SearchMembersForRootInput = z.input<typeof searchMembersForRootInput>;
type ParsedSearchMembersForRootInput = z.output<typeof searchMembersForRootInput>;

export type MemberSearchMembership = {
  memberId: string;
  agencyId: string;
  agencyName: string;
  agencyPlan: Plan;
  role: MemberRole;
  joinedAt: Date;
  lastActiveAt: Date;
};

export type MemberSearchRow = {
  clerkUserId: string;
  /** Canonical identity — email of the most-recently-updated Member row. */
  email: string;
  name: string | null;
  memberships: MemberSearchMembership[];
  /** Most recent `Member.updatedAt` across every membership. */
  lastActiveAt: Date;
};

function buildMemberSearchWhere(
  input: ParsedSearchMembersForRootInput,
): Prisma.MemberWhereInput | null {
  if (!input.search) return null;

  const q = input.search;
  const clauses: Prisma.MemberWhereInput[] = [
    { email: { contains: q, mode: "insensitive" } },
    { name: { contains: q, mode: "insensitive" } },
  ];
  // A Clerk id is opaque but always starts `user_`. Exact match only —
  // substring on a cuid returns garbage.
  if (q.startsWith("user_")) {
    clauses.push({ clerkUserId: q });
  }
  return { OR: clauses };
}

/**
 * Paginated search across every `Member` row grouped by `clerkUserId`. Read-
 * open to every system role. Empty search resolves to zero rows without
 * touching the DB.
 */
export async function searchMembersForRoot(
  ctx: SystemAdminContext,
  rawInput: Partial<SearchMembersForRootInput> = {},
): Promise<{ rows: MemberSearchRow[]; total: number }> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const input = searchMembersForRootInput.parse(rawInput);
  const where = buildMemberSearchWhere(input);
  if (where === null) return { rows: [], total: 0 };

  // Group by clerkUserId, carrying the max updatedAt so we can sort +
  // paginate on "most-recently-active" without pulling every Member row.
  // `_count` is cheap on the same key; we don't need it downstream but it
  // makes the total-count contract explicit (== groups.length).
  const groups = await prisma.member.groupBy({
    by: ["clerkUserId"],
    where,
    _max: { updatedAt: true },
  });
  const total = groups.length;
  if (total === 0) return { rows: [], total: 0 };

  const sorted = [...groups].sort((a, b) => {
    const at = a._max.updatedAt?.getTime() ?? 0;
    const bt = b._max.updatedAt?.getTime() ?? 0;
    return bt - at;
  });
  const pageIds = sorted.slice(input.skip, input.skip + input.take).map((g) => g.clerkUserId);
  if (pageIds.length === 0) return { rows: [], total };

  const memberRows = await prisma.member.findMany({
    where: { clerkUserId: { in: pageIds } },
    select: {
      id: true,
      clerkUserId: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      agency: {
        select: {
          id: true,
          name: true,
          plan: true,
        },
      },
    },
  });

  // Bucket by clerkUserId. The canonical (email, name) is the most-recently-
  // updated Member row — an operator who searches for a stale email should
  // still find the person, but we display the current identity.
  const bucketed = new Map<string, MemberSearchRow>();
  for (const m of memberRows) {
    const bucket = bucketed.get(m.clerkUserId);
    if (bucket) {
      if (m.updatedAt.getTime() > bucket.lastActiveAt.getTime()) {
        bucket.email = m.email;
        bucket.name = m.name;
        bucket.lastActiveAt = m.updatedAt;
      }
      bucket.memberships.push(toMembership(m));
    } else {
      bucketed.set(m.clerkUserId, {
        clerkUserId: m.clerkUserId,
        email: m.email,
        name: m.name,
        memberships: [toMembership(m)],
        lastActiveAt: m.updatedAt,
      });
    }
  }

  // Preserve the paginated ordering exactly (Prisma's `in` doesn't guarantee).
  const orderedRows: MemberSearchRow[] = pageIds
    .map((id) => bucketed.get(id))
    .filter((r): r is MemberSearchRow => r !== undefined)
    .map((r) => ({
      ...r,
      memberships: [...r.memberships].sort((a, b) => {
        const ranked = MEMBER_ROLE_RANK[a.role] - MEMBER_ROLE_RANK[b.role];
        if (ranked !== 0) return ranked;
        return b.lastActiveAt.getTime() - a.lastActiveAt.getTime();
      }),
    }));

  return { rows: orderedRows, total };
}

function toMembership(m: {
  id: string;
  role: MemberRole;
  createdAt: Date;
  updatedAt: Date;
  agency: { id: string; name: string; plan: Plan };
}): MemberSearchMembership {
  return {
    memberId: m.id,
    agencyId: m.agency.id,
    agencyName: m.agency.name,
    agencyPlan: m.agency.plan,
    role: m.role,
    joinedAt: m.createdAt,
    lastActiveAt: m.updatedAt,
  };
}

const MEMBER_ROLE_RANK: Record<MemberRole, number> = {
  OWNER: 0,
  ADMIN: 1,
  EDITOR: 2,
  REVIEWER: 3,
};

// ============================================================
// Drilldown — identity card with Clerk metadata
// ============================================================

export type ClerkMetadata = {
  primaryEmail: string | null;
  lastSignInAt: Date | null;
  twoFactorEnabled: boolean;
  banned: boolean;
  createdAt: Date | null;
  imageUrl: string | null;
} | null; // null when we couldn't reach Clerk

export type MemberIdentityDetail = MemberSearchRow & {
  clerk: ClerkMetadata;
};

/**
 * Full identity card for one Clerk user across every agency. Adds a
 * single `clerkClient.users.getUser` round-trip on top of the search
 * query — okay for a drilldown (one call per opened row), never call
 * from a list view.
 *
 * Clerk lookup failures downgrade to `clerk: null` rather than throwing
 * so the surface still renders. The audit log is where we'd notice a
 * persistent Clerk outage.
 */
export async function getMemberIdentityDetail(
  ctx: SystemAdminContext,
  clerkUserId: string,
): Promise<MemberIdentityDetail> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const memberRows = await prisma.member.findMany({
    where: { clerkUserId },
    select: {
      id: true,
      clerkUserId: true,
      email: true,
      name: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      agency: {
        select: { id: true, name: true, plan: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (memberRows.length === 0) {
    throw new NotFoundError(`No Member row with clerkUserId=${clerkUserId}`);
  }

  const canonical = memberRows[0]!;
  const row: MemberSearchRow = {
    clerkUserId: canonical.clerkUserId,
    email: canonical.email,
    name: canonical.name,
    lastActiveAt: canonical.updatedAt,
    memberships: memberRows.map(toMembership).sort((a, b) => {
      const ranked = MEMBER_ROLE_RANK[a.role] - MEMBER_ROLE_RANK[b.role];
      if (ranked !== 0) return ranked;
      return b.lastActiveAt.getTime() - a.lastActiveAt.getTime();
    }),
  };

  const clerk = await fetchClerkMetadata(clerkUserId);
  return { ...row, clerk };
}

async function fetchClerkMetadata(clerkUserId: string): Promise<ClerkMetadata> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(clerkUserId);
    const primary =
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ??
      user.emailAddresses[0];
    return {
      primaryEmail: primary?.emailAddress ?? null,
      lastSignInAt: user.lastSignInAt ? new Date(user.lastSignInAt) : null,
      twoFactorEnabled: Boolean(user.twoFactorEnabled),
      banned: Boolean(user.banned),
      createdAt: user.createdAt ? new Date(user.createdAt) : null,
      imageUrl: user.imageUrl ?? null,
    };
  } catch (err) {
    console.warn(
      `[users] Clerk getUser failed for ${clerkUserId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}
