import "server-only";

import { NotFoundError } from "@/server/auth/errors";
import {
  assertSystemRole,
  SYSTEM_WRITE_ROLES,
  type SystemAdminContext,
} from "@/server/auth/system";
import { SYSTEM_AUDIT_ACTIONS } from "./audit-actions";
import { withSystemAudit } from "./audit";

/**
 * Phase 3.6.6 — server-side bookkeeping for the impersonation envelope.
 *
 * Cookie minting / clearing happens in the route layer (server actions
 * that call `setImpersonationCookie` / `clearImpersonationCookie`). This
 * module owns the audit trail + permission gates so the route handlers
 * stay thin.
 *
 * Read-only impersonation is gated to OPERATOR + ROOT. SUPPORT can read
 * everything across tenants but can't drop into a Member seat (would let
 * them see the agency's full editor surface, not just support-relevant
 * data). ANALYST has no write surface at all.
 */

export type StartImpersonationInput = {
  agencyId: string;
  memberId: string;
  /** Source IP — written verbatim to the audit row. */
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type StartedImpersonation = {
  systemAdminId: string;
  agencyId: string;
  memberId: string;
  /** Display fields surfaced by the banner so we don't re-query at render time. */
  memberEmail: string;
  memberName: string | null;
  agencyName: string;
  startedAt: Date;
};

/**
 * Verify the impersonation target + write the IMPERSONATE_START audit row
 * in a single transaction. Returns the snapshot the caller needs to mint
 * the signed cookie. Throws `NotFoundError` when the target member doesn't
 * belong to the named agency (defends against UI drift where someone
 * crafts a URL with a mismatched pair).
 */
export async function startImpersonation(
  ctx: SystemAdminContext,
  input: StartImpersonationInput,
): Promise<StartedImpersonation> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);

  return withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.IMPERSONATE_START,
      targetAgencyId: input.agencyId,
      targetMemberId: input.memberId,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
    async (tx, audit) => {
      const member = await tx.member.findUnique({
        where: { id: input.memberId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          agencyId: true,
          agency: { select: { id: true, name: true } },
        },
      });

      if (!member || member.agencyId !== input.agencyId) {
        throw new NotFoundError(`Member ${input.memberId} not found in agency ${input.agencyId}`);
      }

      const startedAt = new Date();
      audit.setAfter({
        mode: "read",
        agencyId: member.agency.id,
        agencyName: member.agency.name,
        memberId: member.id,
        memberEmail: member.email,
        memberRole: member.role,
        startedAt: startedAt.toISOString(),
      });

      return {
        systemAdminId: ctx.admin.id,
        agencyId: member.agency.id,
        memberId: member.id,
        memberEmail: member.email,
        memberName: member.name,
        agencyName: member.agency.name,
        startedAt,
      };
    },
  );
}

export type EndImpersonationInput = {
  /** Captured from the cookie payload — written into the audit row. */
  agencyId: string;
  memberId: string;
  startedAt: string;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Write the IMPERSONATE_END audit row. No `assertSystemRole` filter — every
 * admin (including SUPPORT/ANALYST, who shouldn't have started an envelope
 * to begin with) can end an envelope that's somehow live in their session.
 * Defensive: if a role got demoted mid-envelope, they still need a way to
 * exit cleanly.
 */
export async function endImpersonation(
  ctx: SystemAdminContext,
  input: EndImpersonationInput,
): Promise<void> {
  await withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.IMPERSONATE_END,
      targetAgencyId: input.agencyId,
      targetMemberId: input.memberId,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
    async (_tx, audit) => {
      audit.setAfter({
        agencyId: input.agencyId,
        memberId: input.memberId,
        startedAt: input.startedAt,
        endedAt: new Date().toISOString(),
      });
    },
  );
}
