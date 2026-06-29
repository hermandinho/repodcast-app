"use server";

import { MemberRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole, requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import { assertPlanCapacity } from "@/server/billing/limits";
import { isLiveDb } from "@/server/data/source";
import { prisma } from "@/server/db/client";
import {
  createInvite as repoCreateInvite,
  revokeInvite as repoRevokeInvite,
} from "@/server/db/invites";
import { recordMemberTransition } from "@/server/db/member-transitions";
import { sendAgencyInviteEmail } from "@/server/email/send";

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

const inviteInput = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]).default("member"),
});

const revokeInviteSchema = z.object({
  inviteId: z.string().min(1),
});

const memberIdInput = z.object({
  memberId: z.string().min(1),
});

const changeRoleInput = memberIdInput.and(
  z.object({
    role: z.enum(["admin", "member"]),
  }),
);

// ============================================================
// Invite a new member (homegrown — no Clerk Org dependency)
// ============================================================

const ROLE_FROM_INPUT: Record<
  "admin" | "member",
  typeof MemberRole.ADMIN | typeof MemberRole.EDITOR
> = {
  admin: MemberRole.ADMIN,
  member: MemberRole.EDITOR,
};

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}

export async function inviteMemberAction(raw: unknown): Promise<ActionResult<{ email: string }>> {
  const parsed = inviteInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid invite", parsed.error.issues);
  }
  const { email, role } = parsed.data;

  if (!isLiveDb()) {
    return { ok: true, data: { email } };
  }

  const auth = await requireAuthContext();
  assertRole(auth, [MemberRole.OWNER, MemberRole.ADMIN]);

  // Seat-limit enforcement uses the existing Phase 1.11 plumbing.
  await assertPlanCapacity(auth.agency.id, auth.agency.plan, "members");

  let invite;
  try {
    invite = await repoCreateInvite(toTenantContext(auth), auth.member.id, {
      email,
      role: ROLE_FROM_INPUT[role],
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't create invite.",
    };
  }

  // Send the email. We await it (rather than fire-and-forget) so the
  // inviter sees a real error if delivery fails — they shouldn't think
  // the email went out when it didn't.
  const acceptUrl = `${appBaseUrl()}/invite/${invite.token}`;
  const result = await sendAgencyInviteEmail(email, {
    inviterName: auth.user.name ?? auth.user.email.split("@")[0],
    agencyName: auth.agency.name,
    roleLabel: invite.role === MemberRole.ADMIN ? "Admin" : "Editor",
    acceptUrl,
    expiresIn: "14 days",
  });
  if (!result.ok) {
    // The invite row exists but no email was delivered. Surface this so
    // the admin can copy the link manually or re-send. (We deliberately
    // don't roll back the row — the admin may want to deliver the link
    // through a different channel.)
    return {
      ok: false,
      error: `Invite created but email failed: ${result.reason}. Link: ${acceptUrl}`,
    };
  }

  await recordMemberTransition(auth.agency.id, {
    kind: "INVITED",
    byMemberId: auth.member.id,
    inviteId: invite.id,
    email,
    toRole: invite.role,
  });

  revalidatePath("/settings/team");
  return { ok: true, data: { email } };
}

// ============================================================
// Revoke a pending invite
// ============================================================

export async function revokeInviteAction(
  raw: unknown,
): Promise<ActionResult<{ inviteId: string }>> {
  const parsed = revokeInviteSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid revoke", parsed.error.issues);
  }
  const { inviteId } = parsed.data;

  if (!isLiveDb()) {
    return { ok: true, data: { inviteId } };
  }

  const auth = await requireAuthContext();
  assertRole(auth, [MemberRole.OWNER, MemberRole.ADMIN]);

  // Snapshot the invite's email before revoking so the activity feed has
  // a readable subject even if the invite is later hard-deleted.
  const inviteSnapshot = await prisma.memberInvite.findFirst({
    where: { id: inviteId, agencyId: auth.agency.id },
    select: { email: true },
  });

  try {
    await repoRevokeInvite(toTenantContext(auth), inviteId);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't revoke invite.",
    };
  }

  await recordMemberTransition(auth.agency.id, {
    kind: "INVITE_REVOKED",
    byMemberId: auth.member.id,
    inviteId,
    email: inviteSnapshot?.email ?? null,
  });

  revalidatePath("/settings/team");
  return { ok: true, data: { inviteId } };
}

// ============================================================
// Change a member's role
// ============================================================

export async function changeMemberRoleAction(
  raw: unknown,
): Promise<ActionResult<{ memberId: string }>> {
  const parsed = changeRoleInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid role change", parsed.error.issues);
  }
  const { memberId, role } = parsed.data;

  if (!isLiveDb()) {
    return { ok: true, data: { memberId } };
  }

  const auth = await requireAuthContext();
  assertRole(auth, [MemberRole.OWNER, MemberRole.ADMIN]);

  // Refuse to demote yourself — the team UI's role-toggle is hidden for
  // self anyway, but defend at the action layer too. Promoting *to* OWNER
  // is gated to `transferOwnershipAction` so we never end up with two
  // OWNERs in the same agency.
  if (memberId === auth.member.id) {
    return { ok: false, error: "You can't change your own role." };
  }

  // Snapshot the prior role so the activity feed can render "Editor → Admin".
  const prior = await prisma.member.findFirst({
    where: { id: memberId, agencyId: auth.agency.id },
    select: { role: true, email: true },
  });

  const { count } = await prisma.member.updateMany({
    where: {
      id: memberId,
      agencyId: auth.agency.id,
      role: { not: MemberRole.OWNER },
    },
    data: { role: ROLE_FROM_INPUT[role] },
  });
  if (count === 0) {
    return { ok: false, error: "Member not found, or can't be changed (OWNER)" };
  }

  if (prior) {
    await recordMemberTransition(auth.agency.id, {
      kind: "ROLE_CHANGED",
      byMemberId: auth.member.id,
      targetMemberId: memberId,
      email: prior.email,
      fromRole: prior.role,
      toRole: ROLE_FROM_INPUT[role],
    });
  }

  revalidatePath("/settings/team");
  return { ok: true, data: { memberId } };
}

// ============================================================
// Transfer ownership
// ============================================================

/**
 * OWNER → another ADMIN. Demotes the current OWNER to ADMIN in the same
 * transaction so the agency always has exactly one OWNER.
 *
 * Restricted to existing ADMINs as targets so Clerk's role (org:admin) is
 * already correct — our OWNER concept sits on top of Clerk's admin tier
 * and isn't mirrored to Clerk.
 */
export async function transferOwnershipAction(
  raw: unknown,
): Promise<ActionResult<{ memberId: string }>> {
  const parsed = memberIdInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid transfer", parsed.error.issues);
  }
  const { memberId } = parsed.data;

  if (!isLiveDb()) {
    return { ok: true, data: { memberId } };
  }

  const auth = await requireAuthContext();
  assertRole(auth, [MemberRole.OWNER]);

  if (memberId === auth.member.id) {
    return { ok: false, error: "You're already the owner." };
  }

  const target = await prisma.member.findFirst({
    where: { id: memberId, agencyId: auth.agency.id },
    select: { id: true, role: true },
  });
  if (!target) return { ok: false, error: "Member not found in this agency" };
  if (target.role !== MemberRole.ADMIN) {
    return {
      ok: false,
      error: "You can only transfer ownership to an existing Admin.",
    };
  }

  await prisma.$transaction([
    prisma.member.update({
      where: { id: auth.member.id },
      data: { role: MemberRole.ADMIN },
    }),
    prisma.member.update({
      where: { id: target.id },
      data: { role: MemberRole.OWNER },
    }),
  ]);

  // One transition row for the ownership transfer itself; the prior OWNER's
  // demotion to ADMIN is implicit in the kind + actor pairing and doesn't
  // get its own ROLE_CHANGED entry (would be noisy).
  await recordMemberTransition(auth.agency.id, {
    kind: "OWNER_TRANSFERRED",
    byMemberId: auth.member.id,
    targetMemberId: target.id,
    fromRole: MemberRole.ADMIN,
    toRole: MemberRole.OWNER,
  });

  revalidatePath("/settings/team");
  return { ok: true, data: { memberId } };
}

// ============================================================
// Remove a member
// ============================================================

export async function removeMemberAction(
  raw: unknown,
): Promise<ActionResult<{ memberId: string }>> {
  const parsed = memberIdInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid remove", parsed.error.issues);
  }
  const { memberId } = parsed.data;

  if (!isLiveDb()) {
    return { ok: true, data: { memberId } };
  }

  const auth = await requireAuthContext();
  assertRole(auth, [MemberRole.OWNER, MemberRole.ADMIN]);

  // Block removing yourself — must transfer ownership first.
  if (memberId === auth.member.id) {
    return { ok: false, error: "You can't remove yourself from the agency." };
  }

  // Snapshot the doomed member's identity for the audit row — Member.email
  // gets carried into the transition so the feed still reads correctly after
  // the row is hard-deleted. (`targetMemberId` will SetNull when the FK
  // cascades; the email + name copy is the durable record.)
  const doomed = await prisma.member.findFirst({
    where: { id: memberId, agencyId: auth.agency.id },
    select: { email: true, role: true },
  });

  // Block removing the OWNER — must transfer ownership first.
  const { count } = await prisma.member.deleteMany({
    where: {
      id: memberId,
      agencyId: auth.agency.id,
      role: { not: MemberRole.OWNER },
    },
  });
  if (count === 0) {
    return {
      ok: false,
      error: "Member not found, or can't be removed (transfer ownership first)",
    };
  }

  if (doomed) {
    await recordMemberTransition(auth.agency.id, {
      kind: "REMOVED",
      byMemberId: auth.member.id,
      // The Member row is gone; targetMemberId will SetNull anyway, so we
      // skip the FK and rely on the snapshotted email for the feed copy.
      email: doomed.email,
      fromRole: doomed.role,
    });
  }

  revalidatePath("/settings/team");
  return { ok: true, data: { memberId } };
}
