import "server-only";

import {
  MemberRole,
  OutputStatus,
  Platform,
  type ClientStatement,
  type Prisma,
} from "@prisma/client";
import { z } from "zod";
import { NotFoundError, ValidationError } from "@/server/auth/errors";
import { requireRole, type TenantContext } from "@/server/auth/tenant";
import { prisma } from "./client";

/**
 * Phase 2.13.4 — Client statements.
 *
 * Generate / list / read white-labeled period statements per client.
 * Aggregates inside one tenant-scoped transaction and persists the totals
 * to a `ClientStatement` row, so the rendered statement (PDF / CSV / portal
 * view) is stable even if the underlying outputs are later regenerated.
 *
 * Role gating: OWNER + ADMIN. Statements are billing material — Editors and
 * Reviewers don't need access.
 */

const ADMIN_ROLES = [MemberRole.OWNER, MemberRole.ADMIN] as const;

// ============================================================
// Input schemas
// ============================================================

export const generateClientStatementInput = z
  .object({
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
  })
  .refine((d) => d.periodStart.getTime() <= d.periodEnd.getTime(), {
    message: "Period start must be before period end.",
    path: ["periodEnd"],
  });

export type GenerateClientStatementInput = z.infer<typeof generateClientStatementInput>;

export const listClientStatementsInput = z.object({
  take: z.number().int().min(1).max(100).default(25),
  skip: z.number().int().min(0).default(0),
});

// ============================================================
// Helpers — period window is end-of-day inclusive on `periodEnd` so a
// caller passing a midnight boundary still gets the whole closing day.
// ============================================================

function endOfDay(d: Date): Date {
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return end;
}

async function assertClientInTenant(ctx: TenantContext, clientId: string): Promise<void> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, agencyId: ctx.agencyId },
    select: { id: true },
  });
  if (!client) throw new NotFoundError(`Client ${clientId} not found`);
}

// ============================================================
// Reads
// ============================================================

export async function listClientStatements(
  ctx: TenantContext,
  clientId: string,
  raw: z.infer<typeof listClientStatementsInput>,
): Promise<{ rows: ClientStatement[]; total: number }> {
  requireRole(ctx, ADMIN_ROLES);
  await assertClientInTenant(ctx, clientId);

  const where: Prisma.ClientStatementWhereInput = {
    clientId,
    client: { agencyId: ctx.agencyId },
  };

  const [rows, total] = await Promise.all([
    prisma.clientStatement.findMany({
      where,
      orderBy: [{ periodStart: "desc" }, { generatedAt: "desc" }],
      take: raw.take,
      skip: raw.skip,
    }),
    prisma.clientStatement.count({ where }),
  ]);
  return { rows, total };
}

export type ClientStatementWithContext = ClientStatement & {
  client: { id: string; name: string; agencyId: string };
  generatedByMember: { id: string; name: string | null; email: string } | null;
  sharedByMember: { id: string; name: string | null; email: string } | null;
};

export async function getClientStatement(
  ctx: TenantContext,
  statementId: string,
): Promise<ClientStatementWithContext> {
  requireRole(ctx, ADMIN_ROLES);
  const row = await prisma.clientStatement.findFirst({
    where: {
      id: statementId,
      client: { agencyId: ctx.agencyId },
    },
    include: {
      client: { select: { id: true, name: true, agencyId: true } },
      generatedByMember: { select: { id: true, name: true, email: true } },
      sharedByMember: { select: { id: true, name: true, email: true } },
    },
  });
  if (!row) throw new NotFoundError(`Statement ${statementId} not found`);
  return row;
}

/**
 * Load a statement with the extra agency-branding context the PDF renderer
 * needs (agency name + brand accent). Same role/tenant guard as
 * `getClientStatement` — the PDF is billing material, OWNER/ADMIN only.
 */
export type ClientStatementForPdf = ClientStatement & {
  client: {
    id: string;
    name: string;
    agencyId: string;
    agency: { id: string; name: string; brandAccentColor: string | null };
  };
  generatedByMember: { id: string; name: string | null; email: string } | null;
};

export async function getClientStatementForPdf(
  ctx: TenantContext,
  statementId: string,
): Promise<ClientStatementForPdf> {
  requireRole(ctx, ADMIN_ROLES);
  const row = await prisma.clientStatement.findFirst({
    where: {
      id: statementId,
      client: { agencyId: ctx.agencyId },
    },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          agencyId: true,
          agency: { select: { id: true, name: true, brandAccentColor: true } },
        },
      },
      generatedByMember: { select: { id: true, name: true, email: true } },
    },
  });
  if (!row) throw new NotFoundError(`Statement ${statementId} not found`);
  return row;
}

// ============================================================
// Portal publish (Phase 3.8)
// ============================================================

/**
 * Flip a statement to portal-visible. Idempotent — a second call updates
 * `sharedByMemberId` to the newer publisher but leaves the original
 * `sharedWithPortalAt` timestamp alone (client-side "first shared at" is
 * the intent, so re-publishing doesn't reset the clock).
 *
 * Returns the current shared timestamp so the caller can render "Shared
 * on <date>" without a second fetch.
 */
export async function shareStatementWithPortal(
  ctx: TenantContext,
  statementId: string,
  byMemberId: string,
): Promise<{ sharedWithPortalAt: Date }> {
  requireRole(ctx, ADMIN_ROLES);
  // updateMany so the tenant filter (client.agencyId) lives in the where
  // clause atomically — a cross-tenant id collapses to a 0-count miss.
  const now = new Date();
  const { count } = await prisma.clientStatement.updateMany({
    where: {
      id: statementId,
      sharedWithPortalAt: null,
      client: { agencyId: ctx.agencyId },
    },
    data: {
      sharedWithPortalAt: now,
      sharedByMemberId: byMemberId,
    },
  });
  if (count === 0) {
    // Either not found (cross-tenant / bad id) or already shared. Discern
    // so already-shared is a no-op success and missing is a 404.
    const current = await prisma.clientStatement.findFirst({
      where: { id: statementId, client: { agencyId: ctx.agencyId } },
      select: { sharedWithPortalAt: true },
    });
    if (!current) throw new NotFoundError(`Statement ${statementId} not found`);
    if (current.sharedWithPortalAt) {
      // Refresh the publisher stamp only — sharedWithPortalAt is sticky.
      await prisma.clientStatement.update({
        where: { id: statementId },
        data: { sharedByMemberId: byMemberId },
      });
      return { sharedWithPortalAt: current.sharedWithPortalAt };
    }
  }
  return { sharedWithPortalAt: now };
}

/**
 * Reverse the publish flag. Nulls both fields so the row falls out of
 * every portal read on the next request. Idempotent when already unshared.
 */
export async function unshareStatementFromPortal(
  ctx: TenantContext,
  statementId: string,
): Promise<void> {
  requireRole(ctx, ADMIN_ROLES);
  const { count } = await prisma.clientStatement.updateMany({
    where: {
      id: statementId,
      client: { agencyId: ctx.agencyId },
    },
    data: {
      sharedWithPortalAt: null,
      sharedByMemberId: null,
    },
  });
  if (count === 0) throw new NotFoundError(`Statement ${statementId} not found`);
}

// ============================================================
// Portal-side reads (no TenantContext — caller must have validated a token)
// ============================================================

export type PortalStatementRow = {
  id: string;
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
  sharedWithPortalAt: Date;
  episodeCount: number;
  outputCount: number;
  approvedCount: number;
  approvalRatePct: number;
  costCents: number;
};

/**
 * Public read — statements the agency has explicitly published to the
 * portal for `clientId`. Callable only after the portal token has been
 * validated (the token IS the auth check); this function trusts the
 * clientId to come from a validated `ClientPortalLink`.
 */
export async function listSharedStatementsForClient(
  clientId: string,
): Promise<PortalStatementRow[]> {
  const rows = await prisma.clientStatement.findMany({
    where: { clientId, sharedWithPortalAt: { not: null } },
    orderBy: { periodStart: "desc" },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      generatedAt: true,
      sharedWithPortalAt: true,
      episodeCount: true,
      outputCount: true,
      approvedCount: true,
      approvalRatePct: true,
      costCents: true,
    },
  });
  // Prisma types sharedWithPortalAt as nullable even with the not-null
  // filter — narrow here so the row type is truthful.
  return rows.map((r) => ({
    ...r,
    sharedWithPortalAt: r.sharedWithPortalAt!,
  }));
}

/**
 * Public PDF fetch. Verifies the statement is (a) shared and (b) belongs
 * to `clientId` — both filters live in the where clause so a mis-scoped
 * id short-circuits to null rather than exposing another client's PDF.
 */
export type SharedStatementForPortalPdf = ClientStatement & {
  client: {
    id: string;
    name: string;
    agency: { id: string; name: string; brandAccentColor: string | null };
  };
  generatedByMember: { name: string | null; email: string } | null;
};

export async function getSharedStatementForPortalPdf(
  clientId: string,
  statementId: string,
): Promise<SharedStatementForPortalPdf | null> {
  return prisma.clientStatement.findFirst({
    where: {
      id: statementId,
      clientId,
      sharedWithPortalAt: { not: null },
    },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          agency: { select: { id: true, name: true, brandAccentColor: true } },
        },
      },
      generatedByMember: { select: { name: true, email: true } },
    },
  });
}

// ============================================================
// Per-platform breakdown (shared by CSV + PDF exporters)
// ============================================================

const BREAKDOWN_PLATFORMS: Platform[] = [
  Platform.TWITTER,
  Platform.LINKEDIN,
  Platform.INSTAGRAM,
  Platform.TIKTOK,
  Platform.SHOW_NOTES,
  Platform.BLOG,
  Platform.NEWSLETTER,
];

export type PlatformBreakdownRow = { platform: Platform; total: number; approved: number };

/**
 * Compute the per-platform total / approved counts inside the statement's
 * window. Not tenant-scoped — the caller (CSV route, PDF route) has
 * already resolved a specific statement + client and passes them in.
 */
export async function computeStatementPlatformBreakdown(params: {
  clientId: string;
  agencyId: string;
  periodStart: Date;
  periodEnd: Date;
}): Promise<PlatformBreakdownRow[]> {
  const groups = await prisma.generatedOutput.groupBy({
    by: ["platform", "status"],
    where: {
      supersededAt: null,
      episode: {
        show: { client: { id: params.clientId, agencyId: params.agencyId } },
      },
      createdAt: { gte: params.periodStart, lte: params.periodEnd },
    },
    _count: { _all: true },
  });

  const byPlatform = new Map<Platform, { total: number; approved: number }>();
  for (const p of BREAKDOWN_PLATFORMS) byPlatform.set(p, { total: 0, approved: 0 });
  for (const g of groups) {
    const slot = byPlatform.get(g.platform);
    if (!slot) continue;
    slot.total += g._count._all;
    if (g.status === OutputStatus.APPROVED) slot.approved += g._count._all;
  }
  return BREAKDOWN_PLATFORMS.map((p) => ({ platform: p, ...byPlatform.get(p)! }));
}

// ============================================================
// Generation
// ============================================================

type Aggregates = {
  episodeCount: number;
  outputCount: number;
  approvedCount: number;
  approvalRatePct: number;
  costCents: number;
};

/**
 * Compute the four totals that the snapshot stores. Runs as four parallel
 * Prisma `count`/`aggregate` calls — cheap, no transaction needed for
 * correctness because the writes are idempotent (the persisted statement
 * row reflects the aggregate at `generatedAt`; a subsequent generate
 * recomputes from scratch).
 */
async function computeAggregates(
  ctx: TenantContext,
  clientId: string,
  periodStart: Date,
  periodEndExclusive: Date,
): Promise<Aggregates> {
  // Tenant + client + window — kept in one factory so each count uses the
  // same shape. Episodes range on `Episode.createdAt`; outputs on the
  // GeneratedOutput's `createdAt` (the user-visible "generated on" date).
  const episodeWindow: Prisma.EpisodeWhereInput = {
    show: { client: { id: clientId, agencyId: ctx.agencyId } },
    createdAt: { gte: periodStart, lte: periodEndExclusive },
  };
  const outputWindow: Prisma.GeneratedOutputWhereInput = {
    supersededAt: null,
    episode: { show: { client: { id: clientId, agencyId: ctx.agencyId } } },
    createdAt: { gte: periodStart, lte: periodEndExclusive },
  };

  const [episodeCount, outputCount, approvedCount, eligibleForApproval, usage] = await Promise.all([
    prisma.episode.count({ where: episodeWindow }),
    prisma.generatedOutput.count({ where: outputWindow }),
    prisma.generatedOutput.count({
      where: { ...outputWindow, status: OutputStatus.APPROVED },
    }),
    // Approval-rate denominator: same as the dashboard's definition
    // (`approved / (approved + ready + in_review)`). Generating + failed
    // don't count toward the editor's headline rate.
    prisma.generatedOutput.count({
      where: {
        ...outputWindow,
        status: {
          in: [OutputStatus.APPROVED, OutputStatus.READY, OutputStatus.IN_REVIEW],
        },
      },
    }),
    prisma.usageLog.aggregate({
      where: {
        agencyId: ctx.agencyId,
        createdAt: { gte: periodStart, lte: periodEndExclusive },
        episode: {
          show: { client: { id: clientId, agencyId: ctx.agencyId } },
        },
      },
      _sum: { costCents: true },
    }),
  ]);

  const approvalRatePct =
    eligibleForApproval === 0 ? 0 : Math.round((approvedCount / eligibleForApproval) * 100);
  return {
    episodeCount,
    outputCount,
    approvedCount,
    approvalRatePct,
    costCents: usage._sum.costCents ?? 0,
  };
}

/**
 * Generate (and persist) a new statement for `clientId` over the given
 * period. Returns the new row.
 *
 * Idempotency: we don't dedupe on `(clientId, periodStart, periodEnd)` —
 * the agency may legitimately want multiple snapshots of the same period
 * (rerun after a late approval, etc.). The list page sorts by
 * `generatedAt` desc so the newest is always at the top.
 */
export async function generateClientStatement(
  ctx: TenantContext,
  clientId: string,
  byMemberId: string,
  input: GenerateClientStatementInput,
): Promise<ClientStatement> {
  requireRole(ctx, ADMIN_ROLES);
  await assertClientInTenant(ctx, clientId);

  if (input.periodEnd.getTime() < input.periodStart.getTime()) {
    throw new ValidationError("Period start must be before period end.");
  }

  const periodEndExclusive = endOfDay(input.periodEnd);
  const aggregates = await computeAggregates(ctx, clientId, input.periodStart, periodEndExclusive);

  return prisma.clientStatement.create({
    data: {
      clientId,
      periodStart: input.periodStart,
      periodEnd: periodEndExclusive,
      episodeCount: aggregates.episodeCount,
      outputCount: aggregates.outputCount,
      approvedCount: aggregates.approvedCount,
      approvalRatePct: aggregates.approvalRatePct,
      costCents: aggregates.costCents,
      generatedByMemberId: byMemberId,
    },
  });
}
