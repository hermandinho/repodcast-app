import "server-only";

import {
  MemberRole,
  type MemberTransition,
  type MemberTransitionKind,
  type Prisma,
} from "@prisma/client";
import { requireReadRole, type TenantContext } from "@/server/auth/tenant";
import { prisma } from "./client";

/**
 * Append-only audit trail for team / membership changes (Phase 2.4).
 * Counterpart to `OutputTransition` — same tenant-denormalized + index
 * pattern, scoped to people instead of outputs.
 */

const READ_ROLES = [
  MemberRole.OWNER,
  MemberRole.ADMIN,
  MemberRole.EDITOR,
  MemberRole.REVIEWER,
] as const;

export type RecordMemberTransitionInput = {
  kind: MemberTransitionKind;
  /** Acting member; null for invite-accepted (self-action by a brand-new user). */
  byMemberId?: string | null;
  /** Subject of the change. Null on INVITED / INVITE_REVOKED (use inviteId). */
  targetMemberId?: string | null;
  /** Invite affected. Used for INVITED / INVITE_ACCEPTED / INVITE_REVOKED. */
  inviteId?: string | null;
  /** Copied email — keeps the activity row readable after the invite row is hard-deleted. */
  email?: string | null;
  fromRole?: MemberRole | null;
  toRole?: MemberRole | null;
  note?: string | null;
};

/**
 * Returns the Prisma write op so callers can splice it into an existing
 * `$transaction`. Use this when the original mutation is itself a txn so
 * the log + the action can never diverge.
 */
export function buildMemberTransitionWrite(
  agencyId: string,
  input: RecordMemberTransitionInput,
): Prisma.PrismaPromise<MemberTransition> {
  return prisma.memberTransition.create({
    data: {
      agencyId,
      kind: input.kind,
      byMemberId: input.byMemberId ?? null,
      targetMemberId: input.targetMemberId ?? null,
      inviteId: input.inviteId ?? null,
      email: input.email ?? null,
      fromRole: input.fromRole ?? null,
      toRole: input.toRole ?? null,
      note: input.note ?? null,
    },
  });
}

/**
 * Standalone fire-and-forget recorder for when the parent action isn't a
 * transaction. Skips role checks — callers are server actions that have
 * already gated.
 */
export async function recordMemberTransition(
  agencyId: string,
  input: RecordMemberTransitionInput,
): Promise<MemberTransition> {
  return buildMemberTransitionWrite(agencyId, input);
}

export type MemberTransitionWithContext = MemberTransition & {
  actor: { id: string; name: string | null; email: string } | null;
  target: { id: string; name: string | null; email: string } | null;
  invite: { email: string } | null;
};

/**
 * Latest N member transitions for the team-page activity feed. Single-table
 * read on `MemberTransition` filtered by `agencyId`, joined to the bare
 * minimum needed to render an activity row.
 */
export async function listMemberTransitions(
  ctx: TenantContext,
  limit = 12,
): Promise<MemberTransitionWithContext[]> {
  requireReadRole(ctx, READ_ROLES);
  return prisma.memberTransition.findMany({
    where: { agencyId: ctx.agencyId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      actor: { select: { id: true, name: true, email: true } },
      target: { select: { id: true, name: true, email: true } },
      invite: { select: { email: true } },
    },
  });
}
