import "server-only";

import { timingSafeEqual } from "node:crypto";
import {
  MemberRole,
  OutputStatus,
  Plan,
  type ClientPortalLink,
  type GeneratedOutput,
} from "@prisma/client";
import { z } from "zod";
import { PORTAL_FEEDBACK_BODY_MAX } from "@/lib/portal-limits";
import { NotFoundError } from "@/server/auth/errors";
import { requireReadRole, requireRole, type TenantContext } from "@/server/auth/tenant";
import { assertMinPlan, getAgencyPlan } from "@/server/billing/limits";
import { prisma } from "./client";

/**
 * Re-export the client-safe body cap so existing server-side consumers
 * (zod schema below, actions layer) keep their existing import path
 * unchanged. The canonical definition lives in `lib/portal-limits.ts` —
 * that's what the portal client component imports.
 */
export { PORTAL_FEEDBACK_BODY_MAX };

/**
 * Phase 2.5 — client-portal links + the public read path.
 *
 * Two surfaces are served from this module:
 *   1. **Agency-side management** (`createPortalLink`, `revokePortalLink`,
 *      `listPortalLinks`) — tenant-scoped, OWNER/ADMIN gated, used by the
 *      mint/revoke UI on the client billing tab.
 *   2. **Public token lookup** (`getPortalLinkByToken`, `logPortalAccess`,
 *      `listPortalDeliverables`, `submitPortalFeedback`) — *no
 *      `TenantContext`*, callable from the public `/portal/[token]`
 *      route. The token itself is the access credential; expiry and
 *      revocation gates live inside `getPortalLinkByToken`.
 *
 * Delivery filter (Phase 3.8): clients see outputs in APPROVED, SCHEDULED,
 * or PUBLISHED — every state where the agency has committed to delivery.
 * Draft states (READY, IN_REVIEW) and FAILED stay hidden. The portal
 * isn't a draft review surface — it's a delivery view spanning the full
 * lifecycle from "approved and waiting" through "shipped".
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
  /** Optional shared password. When set (non-empty after trim), the portal
   *  gate renders a password form before showing deliverables. Stored
   *  plaintext by design — see the Client model doc for the rationale.
   *  `.transform().optional()` (not the reverse) so the output type keeps
   *  the key truly optional — callers can omit it, not just pass
   *  `undefined`. */
  password: z
    .string()
    .max(200)
    .transform((v) => {
      const trimmed = v.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    })
    .optional(),
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
  // Client portals unlock at AGENCY — the "branded client portal"
  // promise on the pricing table. Gate at the mint step; existing links
  // keep working (the public read path doesn't re-check the plan) so a
  // downgrade doesn't strand deliverables the client already has a URL
  // for.
  const plan = await getAgencyPlan(ctx.agencyId);
  assertMinPlan(plan, Plan.AGENCY);
  await assertClientInTenant(ctx, input.clientId);
  const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
  return prisma.clientPortalLink.create({
    data: {
      clientId: input.clientId,
      expiresAt,
      createdByMemberId,
      // Optional shared secret. Undefined → column stays null and the
      // portal page skips the gate; a trimmed string → gate is on.
      password: input.password ?? null,
      // token defaults to cuid() at the schema layer.
    },
  });
}

/**
 * Portal gate verification. Called by the password form on
 * `/portal/[token]` before the deliverables render. No `TenantContext`
 * — the caller is unauthenticated (this IS the auth step). Constant-time
 * comparison keeps the check safe against timing-based guessing even
 * though the password is short-lived and low-stakes.
 *
 * Returns:
 *   - `{ ok: true }` when the link exists, isn't revoked/expired, and
 *     the submitted password matches;
 *   - `{ ok: false }` for every other case (missing / revoked / expired /
 *     wrong password / link doesn't require one). Discrete error copy
 *     lives on the form; the helper just gates access.
 */
export function verifyPortalPassword(stored: string | null, submitted: string): boolean {
  if (!stored) return false;
  const a = Buffer.from(stored, "utf8");
  const b = Buffer.from(submitted, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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
  requireReadRole(ctx, READ_ROLES);
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
    /**
     * Optional client-level billing extras surfaced on the portal. Currently
     * only `paymentLinkUrl` — an external URL (Stripe payment-link, custom
     * checkout, etc.) the agency configured on the client billing tab.
     * Repodcast doesn't process the payment; the button just hands off.
     */
    billingProfile: { paymentLinkUrl: string | null } | null;
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
          billingProfile: { select: { paymentLinkUrl: true } },
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
 *
 * Deliberately NOT wrapped in `prisma.$transaction([...])` — the writes have
 * no atomicity requirement (log row is append-only, `lastAccessedAt` is a
 * UX-only "last seen" display) and the transaction API's connection-lease
 * step times out with P2028 when this runs after the response has already
 * been sent (common when the caller does `void logPortalAccess(...)`).
 * Independent awaits keep both writes best-effort with no shared timeout.
 */
export async function logPortalAccess(
  linkId: string,
  meta: { ipHash?: string | null; userAgent?: string | null } = {},
): Promise<void> {
  try {
    await prisma.clientPortalAccessLog.create({
      data: {
        portalLinkId: linkId,
        ipHash: meta.ipHash ?? null,
        userAgent: meta.userAgent ?? null,
      },
    });
  } catch (err) {
    console.warn("[portal] access log failed", err);
  }
  try {
    await prisma.clientPortalLink.update({
      where: { id: linkId },
      data: { lastAccessedAt: new Date() },
    });
  } catch (err) {
    console.warn("[portal] lastAccessedAt bump failed", err);
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
 * Public read of the client's deliverables. Gated by the caller having
 * already validated a portal token, which is why this takes a raw
 * `clientId` instead of a `TenantContext`.
 *
 * Filter: current-version outputs in APPROVED / SCHEDULED / PUBLISHED —
 * every state where the agency has committed to delivery. Draft states
 * (READY, IN_REVIEW) stay hidden; the portal is a delivery view, not a
 * review surface. FAILED is also hidden — a failed schedule attempt is
 * agency-internal, not client-facing.
 *
 * Ordered newest-first by the most recent lifecycle event that applies
 * (`publishedAt ?? scheduledFor ?? approvedAt`). Prisma's orderBy doesn't
 * accept a coalesced expression, so we fetch a small superset (bounded by
 * `take`) and sort in memory.
 */
export async function listPortalDeliverables(
  clientId: string,
  take = 100,
): Promise<PortalDeliverableRow[]> {
  const rows = await prisma.generatedOutput.findMany({
    where: {
      supersededAt: null,
      status: {
        in: [
          OutputStatus.AWAITING_CLIENT_APPROVAL,
          OutputStatus.APPROVED,
          OutputStatus.SCHEDULED,
          OutputStatus.PUBLISHED,
        ],
      },
      episode: { show: { clientId } },
    },
    // Sort by createdAt so AWAITING_CLIENT_APPROVAL rows (which don't yet
    // have `approvedAt`) still land in the take-cap. In-memory sort below
    // refines by lifecycle date.
    orderBy: { createdAt: "desc" },
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
  return rows.sort((a, b) => lifecycleTs(b) - lifecycleTs(a));
}

/**
 * Client-portal "outputs awaiting your approval" — the actionable queue at
 * the top of the portal page. Uses the same tenancy scoping as
 * `listPortalDeliverables`; caller has already validated the token.
 */
export async function listPortalPendingApprovals(
  clientId: string,
): Promise<PortalDeliverableRow[]> {
  return prisma.generatedOutput.findMany({
    where: {
      supersededAt: null,
      status: OutputStatus.AWAITING_CLIENT_APPROVAL,
      episode: { show: { clientId } },
    },
    orderBy: { sentToClientAt: "desc" },
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

/** Timestamp of the most recent lifecycle event on a portal-visible row. */
function lifecycleTs(o: PortalDeliverableRow): number {
  const t = o.publishedAt ?? o.scheduledFor ?? o.approvedAt ?? o.sentToClientAt;
  return t ? t.getTime() : 0;
}

// ============================================================
// Portal feedback (Phase 3.8)
// ============================================================
// The `PORTAL_FEEDBACK_BODY_MAX` cap is imported from `@/lib/portal-limits`
// at the top of the file and re-exported from there. See the top of this
// file for the "why".

/** Feedback submissions permitted per portal link within the throttle window. */
const PORTAL_FEEDBACK_MAX_PER_WINDOW = 8;
const PORTAL_FEEDBACK_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export const submitPortalFeedbackInput = z.object({
  token: z.string().min(1),
  outputId: z.string().min(1).optional(),
  body: z.string().min(1).max(PORTAL_FEEDBACK_BODY_MAX),
  fromEmail: z.string().email().max(200).optional(),
});
export type SubmitPortalFeedbackInput = z.infer<typeof submitPortalFeedbackInput>;

/**
 * Public feedback submission from a `/portal/[token]` viewer. Validates the
 * token the same way `getPortalLinkByToken` does (expiry + revocation), then
 * appends a `ClientPortalFeedback` row.
 *
 * Throttle: caps at `PORTAL_FEEDBACK_MAX_PER_WINDOW` submissions per link in
 * a rolling `PORTAL_FEEDBACK_WINDOW_MS`. Portal tokens are already the
 * access credential, so this is a soft anti-spam gate rather than a hard
 * security boundary. Returns discrete error shapes the UI can render:
 *   - `{ ok: false, reason: "invalid_token" }` — token missing / revoked / expired
 *   - `{ ok: false, reason: "throttled" }` — over the per-link cap
 *   - `{ ok: true, feedbackId }` — persisted
 */
export type SubmitPortalFeedbackResult =
  { ok: true; feedbackId: string } | { ok: false; reason: "invalid_token" | "throttled" };

export async function submitPortalFeedback(
  input: SubmitPortalFeedbackInput,
): Promise<SubmitPortalFeedbackResult> {
  const link = await getPortalLinkByToken(input.token);
  if (!link) return { ok: false, reason: "invalid_token" };

  const windowStart = new Date(Date.now() - PORTAL_FEEDBACK_WINDOW_MS);
  const recentCount = await prisma.clientPortalFeedback.count({
    where: { portalLinkId: link.id, createdAt: { gte: windowStart } },
  });
  if (recentCount >= PORTAL_FEEDBACK_MAX_PER_WINDOW) {
    return { ok: false, reason: "throttled" };
  }

  const row = await prisma.clientPortalFeedback.create({
    data: {
      portalLinkId: link.id,
      outputId: input.outputId ?? null,
      fromEmail: input.fromEmail ?? null,
      body: input.body.trim(),
    },
    select: { id: true },
  });
  return { ok: true, feedbackId: row.id };
}

// ============================================================
// Portal approval + revision-request (Phase 3.9)
// ============================================================
// Wrappers around `clientApproveOutputFromPortal` and
// `clientRequestRevisionFromPortal` in `server/db/outputs.ts`. This file
// owns the token → agencyId resolution + rate-limiting layer so the raw
// helpers stay agnostic and easily testable. Rate limits reuse the
// feedback window since both flows are portal-user writes.

export const portalApprovalInput = z.object({
  token: z.string().min(1),
  outputId: z.string().min(1),
  fromEmail: z.string().email().max(200).optional(),
});
export type PortalApprovalInput = z.infer<typeof portalApprovalInput>;

export const portalRevisionRequestInput = z.object({
  token: z.string().min(1),
  outputId: z.string().min(1),
  fromEmail: z.string().email().max(200).optional(),
  note: z.string().min(1).max(PORTAL_FEEDBACK_BODY_MAX).optional(),
});
export type PortalRevisionRequestInput = z.infer<typeof portalRevisionRequestInput>;

export type PortalApprovalResult =
  { ok: true } | { ok: false; reason: "invalid_token" | "throttled" | "not_pending" | "not_found" };

export async function submitPortalApproval(
  input: PortalApprovalInput,
): Promise<PortalApprovalResult> {
  const link = await getPortalLinkByToken(input.token);
  if (!link) return { ok: false, reason: "invalid_token" };
  if (await isPortalWriteThrottled(link.id)) return { ok: false, reason: "throttled" };

  const { clientApproveOutputFromPortal } = await import("./outputs");
  try {
    // Assert the output belongs to this portal's client — the outputs helper
    // scopes by agencyId, but the token is bound to one specific client, so
    // we tighten to that.
    await assertOutputBelongsToClient(input.outputId, link.clientId);
    await clientApproveOutputFromPortal({
      agencyId: link.client.agency.id,
      outputId: input.outputId,
      approvalEmail: input.fromEmail ?? null,
    });
    return { ok: true };
  } catch (err) {
    return mapPortalWriteError(err);
  }
}

export async function submitPortalRevisionRequest(
  input: PortalRevisionRequestInput,
): Promise<PortalApprovalResult> {
  const link = await getPortalLinkByToken(input.token);
  if (!link) return { ok: false, reason: "invalid_token" };
  if (await isPortalWriteThrottled(link.id)) return { ok: false, reason: "throttled" };

  const { clientRequestRevisionFromPortal } = await import("./outputs");
  try {
    await assertOutputBelongsToClient(input.outputId, link.clientId);
    await clientRequestRevisionFromPortal({
      agencyId: link.client.agency.id,
      outputId: input.outputId,
      requesterEmail: input.fromEmail ?? null,
      note: input.note?.trim(),
    });
    // Also drop a ClientPortalFeedback row so the agency's inbox surfaces
    // the revision note alongside general feedback. Optional note becomes
    // the body; when the client only clicked "Request revision" without a
    // note, we still record an audit-facing feedback entry.
    await prisma.clientPortalFeedback.create({
      data: {
        portalLinkId: link.id,
        outputId: input.outputId,
        fromEmail: input.fromEmail ?? null,
        body: input.note?.trim() || "Revision requested (no note)",
      },
    });
    return { ok: true };
  } catch (err) {
    return mapPortalWriteError(err);
  }
}

async function isPortalWriteThrottled(linkId: string): Promise<boolean> {
  const windowStart = new Date(Date.now() - PORTAL_FEEDBACK_WINDOW_MS);
  const recentCount = await prisma.clientPortalFeedback.count({
    where: { portalLinkId: linkId, createdAt: { gte: windowStart } },
  });
  return recentCount >= PORTAL_FEEDBACK_MAX_PER_WINDOW;
}

async function assertOutputBelongsToClient(outputId: string, clientId: string): Promise<void> {
  const row = await prisma.generatedOutput.findFirst({
    where: { id: outputId, episode: { show: { clientId } } },
    select: { id: true },
  });
  if (!row) throw new NotFoundError(`Output ${outputId} not found`);
}

function mapPortalWriteError(err: unknown): PortalApprovalResult {
  if (err instanceof NotFoundError) return { ok: false, reason: "not_found" };
  // ValidationError from the outputs helper = state mismatch (already
  // approved, or not in AWAITING_CLIENT_APPROVAL).
  const message = err instanceof Error ? err.message : String(err);
  if (/not awaiting client approval|not editable/i.test(message)) {
    return { ok: false, reason: "not_pending" };
  }
  console.error("[portal] approval write failed", err);
  throw err;
}

// ============================================================
// Agency-side feedback reads + triage (Phase 3.8)
// ============================================================

export type PortalFeedbackRow = {
  id: string;
  portalLinkId: string;
  outputId: string | null;
  fromEmail: string | null;
  body: string;
  createdAt: Date;
  readAt: Date | null;
  readByName: string | null;
  readByEmail: string | null;
  /** Populated when `outputId` resolves to a still-existing output. */
  output: {
    id: string;
    platform: string;
    episodeId: string;
    episodeTitle: string;
    showName: string;
  } | null;
};

/**
 * Agency-side feedback list for a single client. Tenant-scoped through the
 * `portalLink.client.agencyId` chain — a cross-agency clientId collapses
 * to an empty result via the where clause, no separate assertion needed.
 *
 * Ordering: unread first (readAt IS NULL), then most-recent within each
 * group. Callers render unread on top with a visual affordance and read
 * items faded below.
 *
 * Output relation is dereferenced by id (no FK on `outputId`) — the
 * separate lookup keeps operational deletes / regenerations from
 * cascading into the feedback ledger. Rows whose target output was
 * deleted or superseded surface with `output = null`.
 */
export async function listPortalFeedbackForClient(
  ctx: TenantContext,
  clientId: string,
): Promise<PortalFeedbackRow[]> {
  requireReadRole(ctx, READ_ROLES);
  const rows = await prisma.clientPortalFeedback.findMany({
    where: {
      portalLink: { clientId, client: { agencyId: ctx.agencyId } },
    },
    orderBy: [{ readAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
    include: {
      readByMember: { select: { name: true, email: true } },
    },
  });

  // Hydrate the output metadata in one round-trip (no FK on outputId, so we
  // resolve manually). Include the show/episode so the ledger can link out.
  const outputIds = Array.from(
    new Set(rows.map((r) => r.outputId).filter((id): id is string => Boolean(id))),
  );
  const outputs = outputIds.length
    ? await prisma.generatedOutput.findMany({
        where: {
          id: { in: outputIds },
          episode: { show: { client: { agencyId: ctx.agencyId } } },
        },
        select: {
          id: true,
          platform: true,
          episode: {
            select: {
              id: true,
              title: true,
              show: { select: { name: true } },
            },
          },
        },
      })
    : [];
  const outputById = new Map(outputs.map((o) => [o.id, o]));

  return rows.map((r) => {
    const o = r.outputId ? outputById.get(r.outputId) : undefined;
    return {
      id: r.id,
      portalLinkId: r.portalLinkId,
      outputId: r.outputId,
      fromEmail: r.fromEmail,
      body: r.body,
      createdAt: r.createdAt,
      readAt: r.readAt,
      readByName: r.readByMember?.name ?? null,
      readByEmail: r.readByMember?.email ?? null,
      output: o
        ? {
            id: o.id,
            platform: o.platform,
            episodeId: o.episode.id,
            episodeTitle: o.episode.title,
            showName: o.episode.show.name,
          }
        : null,
    };
  });
}

/**
 * Per-client unread feedback count. Used by the client-header /
 * navigation to surface a badge without loading the full ledger.
 */
export async function countUnreadPortalFeedback(
  ctx: TenantContext,
  clientId: string,
): Promise<number> {
  requireReadRole(ctx, READ_ROLES);
  return prisma.clientPortalFeedback.count({
    where: {
      readAt: null,
      portalLink: { clientId, client: { agencyId: ctx.agencyId } },
    },
  });
}

/**
 * Agency-wide unread feedback count across every client. Powers the
 * sidebar badge on the Clients nav item — one query per dashboard page
 * render, so it's a plain indexed COUNT with no join expansion.
 */
export async function countUnreadPortalFeedbackForAgency(ctx: TenantContext): Promise<number> {
  requireReadRole(ctx, READ_ROLES);
  return prisma.clientPortalFeedback.count({
    where: {
      readAt: null,
      portalLink: { client: { agencyId: ctx.agencyId } },
    },
  });
}

/**
 * Per-client unread counts across the entire agency. Powers the
 * `/clients` list surface: pills on each client card + top-of-page
 * summary strip. Prisma's `groupBy` doesn't cross the nested relation
 * (`portalLink.clientId`), so we fetch the un-joined slim rows and count
 * in memory. Unread feedback is a small dataset by construction — the
 * whole reason it's unread is that a human hasn't triaged it yet.
 *
 * Returns a Map keyed by `clientId`. Missing entries mean zero unread.
 */
export async function unreadPortalFeedbackByClient(
  ctx: TenantContext,
): Promise<Map<string, number>> {
  requireReadRole(ctx, READ_ROLES);
  const rows = await prisma.clientPortalFeedback.findMany({
    where: {
      readAt: null,
      portalLink: { client: { agencyId: ctx.agencyId } },
    },
    select: { portalLink: { select: { clientId: true } } },
  });
  const counts = new Map<string, number>();
  for (const r of rows) {
    const id = r.portalLink.clientId;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * Flip a feedback row from unread → read, stamping the acting member.
 * Idempotent when already-read — the caller can render both "mark read"
 * and "mark unread" affordances against the same row without racing.
 *
 * `TenantContext` doesn't carry the acting member id, so the action layer
 * passes it explicitly (mirrors the pattern used by `unscheduleOutput`).
 */
export async function markPortalFeedbackRead(
  ctx: TenantContext,
  feedbackId: string,
  memberId: string,
): Promise<void> {
  requireReadRole(ctx, READ_ROLES);
  // updateMany so the tenant filter (portalLink.client.agencyId) is
  // enforced atomically — a cross-tenant id collapses to 0 count, which
  // we surface as NotFoundError.
  const { count } = await prisma.clientPortalFeedback.updateMany({
    where: {
      id: feedbackId,
      readAt: null,
      portalLink: { client: { agencyId: ctx.agencyId } },
    },
    data: {
      readAt: new Date(),
      readByMemberId: memberId,
    },
  });
  if (count === 0) {
    // Row exists and is already read? Fine — no-op. Missing entirely /
    // cross-tenant? That's a NotFoundError.
    const exists = await prisma.clientPortalFeedback.count({
      where: {
        id: feedbackId,
        portalLink: { client: { agencyId: ctx.agencyId } },
      },
    });
    if (exists === 0) {
      throw new NotFoundError(`Feedback ${feedbackId} not found`);
    }
  }
}

/**
 * Bulk mark-read scoped to a single output. Called from every editor
 * action that implies "the agency saw and acted on the client's request":
 * opening the output drawer, editing the content, kicking off a
 * regenerate. Marks every unread `ClientPortalFeedback` row that
 * targets this outputId as read, stamping the acting member.
 *
 * Tenancy is enforced through the `portalLink.client.agencyId` chain in
 * the where clause, atomically — a cross-tenant outputId collapses to
 * `count: 0` (silent no-op) rather than throwing, because callers fire
 * this best-effort alongside another primary write and shouldn't have
 * to catch NotFound just to keep going. Returns the number of rows
 * flipped so caller telemetry can log a meaningful count when it
 * matters (all current callers ignore it).
 */
export async function markPortalFeedbackReadForOutput(
  ctx: TenantContext,
  outputId: string,
  memberId: string,
): Promise<number> {
  requireReadRole(ctx, READ_ROLES);
  const { count } = await prisma.clientPortalFeedback.updateMany({
    where: {
      outputId,
      readAt: null,
      portalLink: { client: { agencyId: ctx.agencyId } },
    },
    data: {
      readAt: new Date(),
      readByMemberId: memberId,
    },
  });
  return count;
}

/**
 * Reverse of `markPortalFeedbackRead` — nulls both stamps so the row
 * re-surfaces in the unread queue. Used when an operator decides they
 * marked something read prematurely.
 */
export async function markPortalFeedbackUnread(
  ctx: TenantContext,
  feedbackId: string,
): Promise<void> {
  requireReadRole(ctx, READ_ROLES);
  const { count } = await prisma.clientPortalFeedback.updateMany({
    where: {
      id: feedbackId,
      portalLink: { client: { agencyId: ctx.agencyId } },
    },
    data: {
      readAt: null,
      readByMemberId: null,
    },
  });
  if (count === 0) throw new NotFoundError(`Feedback ${feedbackId} not found`);
}
