import "server-only";

import { MemberRole, OutputStatus, type ClientStatement, type Prisma } from "@prisma/client";
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
    },
  });
  if (!row) throw new NotFoundError(`Statement ${statementId} not found`);
  return row;
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
