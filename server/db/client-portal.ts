import "server-only";

import {
  MemberRole,
  OutputStatus,
  type ClientPortalLink,
  type GeneratedOutput,
} from "@prisma/client";
import { z } from "zod";
import { NotFoundError } from "@/server/auth/errors";
import { requireRole, type TenantContext } from "@/server/auth/tenant";
import { prisma } from "./client";

/**
 * Phase 2.5 — client-portal links + the public read path.
 *
 * Two surfaces are served from this module:
 *   1. **Agency-side management** (`createPortalLink`, `revokePortalLink`,
 *      `listPortalLinks`) — tenant-scoped, OWNER/ADMIN gated, used by the
 *      mint/revoke UI on the client billing tab.
 *   2. **Public token lookup** (`getPortalLinkByToken`,
 *      `logPortalAccess`, `listApprovedDeliverablesForPortal`) — *no
 *      `TenantContext`*, callable from the public `/portal/[token]`
 *      route. The token itself is the access credential; expiry and
 *      revocation gates live inside `getPortalLinkByToken`.
 *
 * Approved-only filter: clients only see outputs the agency has already
 * signed off on (`status = APPROVED`, `supersededAt = null`). The portal
 * isn't a draft review surface — it's a delivery receipt.
 */

// ============================================================
// Role gates
// ============================================================

const READ_ROLES = [
  MemberRole.OWNER,
  MemberRole.ADMIN,
  MemberRole.EDITOR,
  MemberRole.REVIEWER,
] as const;

const WRITE_ROLES = [MemberRole.OWNER, MemberRole.ADMIN] as const;

// ============================================================
// Input schemas
// ============================================================

export const createPortalLinkInput = z.object({
  clientId: z.string().min(1),
  /** Number of days the link is valid for. UI offers 7 / 30 / 90. */
  expiresInDays: z.number().int().min(1).max(365).default(30),
});
export type CreatePortalLinkInput = z.infer<typeof createPortalLinkInput>;

// ============================================================
// Agency-side writes
// ============================================================

async function assertClientInTenant(ctx: TenantContext, clientId: string): Promise<void> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, agencyId: ctx.agencyId },
    select: { id: true },
  });
  if (!client) throw new NotFoundError(`Client ${clientId} not found`);
}

export async function createPortalLink(
  ctx: TenantContext,
  input: CreatePortalLinkInput,
  createdByMemberId: string,
): Promise<ClientPortalLink> {
  requireRole(ctx, WRITE_ROLES);
  await assertClientInTenant(ctx, input.clientId);
  const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
  return prisma.clientPortalLink.create({
    data: {
      clientId: input.clientId,
      expiresAt,
      createdByMemberId,
      // token defaults to cuid() at the schema layer.
    },
  });
}

/**
 * Soft-revoke — stamps `revokedAt` so `getPortalLinkByToken` rejects the
 * link going forward. We keep the row so the access log retains its
 * foreign-key target for audit reads.
 */
export async function revokePortalLink(ctx: TenantContext, linkId: string): Promise<void> {
  requireRole(ctx, WRITE_ROLES);
  // updateMany so the tenant filter (client.agencyId) lives in the where
  // clause atomically — a cross-tenant id collapses to a 0-count miss.
  const { count } = await prisma.clientPortalLink.updateMany({
    where: {
      id: linkId,
      revokedAt: null,
      client: { agencyId: ctx.agencyId },
    },
    data: { revokedAt: new Date() },
  });
  if (count === 0) {
    throw new NotFoundError(`Portal link ${linkId} not found or already revoked`);
  }
}

export type PortalLinkListRow = ClientPortalLink & {
  createdByMember: { id: string; name: string | null; email: string } | null;
};

export async function listPortalLinks(
  ctx: TenantContext,
  clientId: string,
): Promise<PortalLinkListRow[]> {
  requireRole(ctx, READ_ROLES);
  await assertClientInTenant(ctx, clientId);
  return prisma.clientPortalLink.findMany({
    where: {
      clientId,
      client: { agencyId: ctx.agencyId },
    },
    orderBy: { createdAt: "desc" },
    include: {
      createdByMember: { select: { id: true, name: true, email: true } },
    },
  });
}

// ============================================================
// Public token lookup (no TenantContext)
// ============================================================

export type PortalLinkWithAgency = ClientPortalLink & {
  client: {
    id: string;
    name: string;
    agency: {
      id: string;
      name: string;
      brandLogoUrl: string | null;
      brandAccentColor: string | null;
    };
  };
};

/**
 * Resolve a portal token. Returns null when the link is missing, revoked,
 * or past its expiry — the public route renders the same 404 for all three
 * so a probing visitor can't distinguish them.
 *
 * No `TenantContext` — the token itself is the credential. The public
 * route MUST treat this as the auth check and never trust the token to
 * unlock the agency dashboard.
 */
export async function getPortalLinkByToken(token: string): Promise<PortalLinkWithAgency | null> {
  const link = await prisma.clientPortalLink.findUnique({
    where: { token },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          agency: {
            select: {
              id: true,
              name: true,
              brandLogoUrl: true,
              brandAccentColor: true,
            },
          },
        },
      },
    },
  });
  if (!link) return null;
  if (link.revokedAt) return null;
  if (link.expiresAt.getTime() <= Date.now()) return null;
  return link;
}

/**
 * Append-only access record. Fire-and-forget from the public route —
 * a failure here must never block the page render (we surface a console
 * warning instead).
 *
 * `ipHash` should be the sha-256 hex of the request IP — we never store
 * the raw IP. `userAgent` is the bare header string.
 */
export async function logPortalAccess(
  linkId: string,
  meta: { ipHash?: string | null; userAgent?: string | null } = {},
): Promise<void> {
  try {
    await prisma.$transaction([
      prisma.clientPortalAccessLog.create({
        data: {
          portalLinkId: linkId,
          ipHash: meta.ipHash ?? null,
          userAgent: meta.userAgent ?? null,
        },
      }),
      prisma.clientPortalLink.update({
        where: { id: linkId },
        data: { lastAccessedAt: new Date() },
      }),
    ]);
  } catch (err) {
    console.warn("[portal] access log failed", err);
  }
}

export type PortalDeliverableRow = GeneratedOutput & {
  episode: {
    id: string;
    title: string;
    recordedAt: Date | null;
    show: { id: string; name: string; host: string };
  };
};

/**
 * Public read of approved deliverables for a client. Used by the portal
 * page — gated by the caller having already validated a portal token,
 * which is why this takes a raw `clientId` instead of a `TenantContext`.
 *
 * Filter: current-version approved outputs only. Ordered newest-first so
 * the most recent delivery is at the top of the portal.
 */
export async function listApprovedDeliverablesForPortal(
  clientId: string,
  take = 100,
): Promise<PortalDeliverableRow[]> {
  return prisma.generatedOutput.findMany({
    where: {
      supersededAt: null,
      status: OutputStatus.APPROVED,
      episode: { show: { clientId } },
    },
    orderBy: { approvedAt: "desc" },
    take,
    include: {
      episode: {
        select: {
          id: true,
          title: true,
          recordedAt: true,
          show: { select: { id: true, name: true, host: true } },
        },
      },
    },
  });
}
