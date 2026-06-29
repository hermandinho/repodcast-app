import "server-only";

import { InviteStatus, MemberRole, type MemberInvite } from "@prisma/client";
import { z } from "zod";
import { NotFoundError, ValidationError } from "@/server/auth/errors";
import { requireRole, type TenantContext } from "@/server/auth/tenant";
import { prisma } from "./client";

// ============================================================
// Input schemas
// ============================================================

export const createInviteInput = z.object({
  email: z.string().email().max(320),
  // The team UI today offers Admin / Editor — REVIEWER lands later. Keep
  // this enum consistent with the role-toggle on /settings/team.
  role: z.enum([MemberRole.ADMIN, MemberRole.EDITOR]).default(MemberRole.EDITOR),
});
export type CreateInviteInput = z.infer<typeof createInviteInput>;

const INVITE_TTL_DAYS = 14;

const ADMIN_ROLES = [MemberRole.OWNER, MemberRole.ADMIN] as const;

// ============================================================
// Reads
// ============================================================

/**
 * Pending invites for the team UI. Excludes accepted/revoked/expired so the
 * list stays short and actionable. Returns most-recent first.
 */
export async function listPendingInvites(ctx: TenantContext): Promise<MemberInvite[]> {
  requireRole(ctx, ADMIN_ROLES);
  // Side-effect: mark anything past its `expiresAt` as EXPIRED so the list
  // is accurate without a background cron. Cheap (`updateMany` on indexed
  // columns) and runs at most once per visit to /settings/team.
  await prisma.memberInvite.updateMany({
    where: {
      agencyId: ctx.agencyId,
      status: InviteStatus.PENDING,
      expiresAt: { lt: new Date() },
    },
    data: { status: InviteStatus.EXPIRED },
  });

  return prisma.memberInvite.findMany({
    where: { agencyId: ctx.agencyId, status: InviteStatus.PENDING },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Public lookup by token — used by `/invite/[token]` *before* the user has
 * authenticated, so this intentionally does NOT take a TenantContext.
 *
 * Returns the invite *with* the agency name for the accept-page copy.
 * Never returns expired invites in PENDING state (mirrors the lazy expiry
 * in `listPendingInvites`).
 */
export async function getInviteByToken(token: string): Promise<
  | (MemberInvite & {
      agency: { id: string; name: string };
    })
  | null
> {
  const invite = await prisma.memberInvite.findUnique({
    where: { token },
    include: { agency: { select: { id: true, name: true } } },
  });
  if (!invite) return null;

  if (invite.status === InviteStatus.PENDING && invite.expiresAt.getTime() < Date.now()) {
    await prisma.memberInvite.update({
      where: { id: invite.id },
      data: { status: InviteStatus.EXPIRED },
    });
    return { ...invite, status: InviteStatus.EXPIRED };
  }
  return invite;
}

// ============================================================
// Mutations
// ============================================================

/**
 * Create an invite. Caller is responsible for sending the email after this
 * returns (we don't fire-and-forget here so the action layer can wait on
 * delivery + bubble errors back to the inviter).
 */
export async function createInvite(
  ctx: TenantContext,
  invitedByMemberId: string,
  input: CreateInviteInput,
): Promise<MemberInvite> {
  requireRole(ctx, ADMIN_ROLES);

  const email = input.email.trim().toLowerCase();

  // Refuse duplicates against an active pending invite for the same email.
  // Re-inviting after revoke/expire is fine and produces a fresh token.
  const existing = await prisma.memberInvite.findFirst({
    where: {
      agencyId: ctx.agencyId,
      email,
      status: InviteStatus.PENDING,
    },
    select: { id: true },
  });
  if (existing) {
    throw new ValidationError(
      `${email} already has a pending invite — revoke it first to send a new one`,
    );
  }

  // Refuse if the email already belongs to an active member of this agency.
  const member = await prisma.member.findFirst({
    where: { agencyId: ctx.agencyId, email },
    select: { id: true },
  });
  if (member) {
    throw new ValidationError(`${email} is already a member of this agency`);
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_TTL_DAYS);

  return prisma.memberInvite.create({
    data: {
      agencyId: ctx.agencyId,
      email,
      role: input.role,
      invitedByMemberId,
      expiresAt,
    },
  });
}

/**
 * Accept an invite. Runs at /invite/[token] after the visitor has signed up
 * / signed in. Creates the `Member` row, marks the invite ACCEPTED, all in
 * one `$transaction`.
 *
 * Soft-fails (returns null) on the obvious bad-token cases so the page can
 * render a clean message instead of a 500.
 */
export async function acceptInvite(
  token: string,
  visitor: { clerkUserId: string; email: string; name: string | null },
): Promise<
  | { ok: true; agencyId: string; memberId: string }
  | {
      ok: false;
      reason: "not-found" | "expired" | "revoked" | "already-accepted" | "email-mismatch";
    }
> {
  const invite = await prisma.memberInvite.findUnique({
    where: { token },
    select: {
      id: true,
      agencyId: true,
      email: true,
      role: true,
      status: true,
      expiresAt: true,
    },
  });
  if (!invite) return { ok: false, reason: "not-found" };
  if (invite.status === InviteStatus.REVOKED) {
    return { ok: false, reason: "revoked" };
  }
  if (invite.status === InviteStatus.ACCEPTED) {
    return { ok: false, reason: "already-accepted" };
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    await prisma.memberInvite
      .update({
        where: { id: invite.id },
        data: { status: InviteStatus.EXPIRED },
      })
      .catch(() => null);
    return { ok: false, reason: "expired" };
  }

  // Strict email match: prevents an intercepted invite link from
  // attaching the wrong account to an agency. Case-insensitive compare to
  // match the lowercase-normalised storage on create.
  if (invite.email.toLowerCase() !== visitor.email.toLowerCase()) {
    return { ok: false, reason: "email-mismatch" };
  }

  const member = await prisma.$transaction(async (tx) => {
    // Upsert protects against a Member already existing for this user in this
    // agency (e.g. they accepted twice in quick succession from different
    // tabs). The role from the invite wins on create; updates to role are
    // ignored to avoid escalation through reused tokens.
    const created = await tx.member.upsert({
      where: {
        agencyId_clerkUserId: {
          agencyId: invite.agencyId,
          clerkUserId: visitor.clerkUserId,
        },
      },
      create: {
        agencyId: invite.agencyId,
        clerkUserId: visitor.clerkUserId,
        role: invite.role,
        email: visitor.email,
        name: visitor.name,
      },
      update: { email: visitor.email, name: visitor.name },
    });
    await tx.memberInvite.update({
      where: { id: invite.id },
      data: {
        status: InviteStatus.ACCEPTED,
        acceptedAt: new Date(),
        acceptedByClerkUserId: visitor.clerkUserId,
      },
    });
    return created;
  });

  return { ok: true, agencyId: invite.agencyId, memberId: member.id };
}

/**
 * Revoke a pending invite. Idempotent for non-pending invites (no-op).
 */
export async function revokeInvite(ctx: TenantContext, inviteId: string): Promise<void> {
  requireRole(ctx, ADMIN_ROLES);
  const { count } = await prisma.memberInvite.updateMany({
    where: {
      id: inviteId,
      agencyId: ctx.agencyId,
      status: InviteStatus.PENDING,
    },
    data: { status: InviteStatus.REVOKED },
  });
  if (count === 0) {
    // Either the invite doesn't exist, belongs to another agency, or has
    // already been accepted/revoked. Treat all three the same to avoid
    // leaking which case applies via error messages.
    throw new NotFoundError(`Invite ${inviteId} not found`);
  }
}
