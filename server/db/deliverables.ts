import "server-only";

import {
  MemberRole,
  OutputStatus,
  Platform,
  type GeneratedOutput,
  type Prisma,
} from "@prisma/client";
import { z } from "zod";
import { NotFoundError } from "@/server/auth/errors";
import { requireReadRole, type TenantContext } from "@/server/auth/tenant";
import { prisma } from "./client";

/**
 * Phase 2.13.3 — Deliverable ledger.
 *
 * Reads the per-client record of every (current-version) `GeneratedOutput`
 * the agency has produced, joined to its episode + the approving member.
 * **No new table** — derived live from `Episode` + `GeneratedOutput` so the
 * ledger stays immune to schema drift and we don't double-write.
 *
 * Role gating: open to all four roles. Editors and reviewers see what they
 * shipped. The CSV export (separate route) tightens to OWNER/ADMIN.
 */

const READ_ROLES = [
  MemberRole.OWNER,
  MemberRole.ADMIN,
  MemberRole.EDITOR,
  MemberRole.REVIEWER,
] as const;

// ============================================================
// Input schema
// ============================================================

export const listDeliverablesFilterInput = z.object({
  /** Inclusive lower bound on `GeneratedOutput.createdAt`. */
  from: z.coerce.date().optional(),
  /** Inclusive upper bound on `GeneratedOutput.createdAt` (widened to EOD). */
  to: z.coerce.date().optional(),
  platform: z.nativeEnum(Platform).optional(),
  status: z.nativeEnum(OutputStatus).optional(),
  take: z.number().int().min(1).max(500).default(25),
  skip: z.number().int().min(0).default(0),
});
export type ListDeliverablesFilterInput = z.infer<typeof listDeliverablesFilterInput>;

// ============================================================
// Row shape
// ============================================================

export type DeliverableRow = GeneratedOutput & {
  episode: {
    id: string;
    title: string;
    recordedAt: Date | null;
  };
  approvedByMember: {
    id: string;
    name: string | null;
    email: string;
  } | null;
};

// ============================================================
// Internal where builder — kept private so the CSV export path can call
// the same query without re-parsing input.
// ============================================================

function endOfDay(d: Date): Date {
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return end;
}

function buildDeliverablesWhere(
  ctx: TenantContext,
  clientId: string,
  filters: Omit<ListDeliverablesFilterInput, "take" | "skip">,
): Prisma.GeneratedOutputWhereInput {
  const where: Prisma.GeneratedOutputWhereInput = {
    // Only the current version of each (episode, platform) slot — the
    // history table is searchable elsewhere, the ledger shows the version
    // the agency actually delivered.
    supersededAt: null,
    episode: {
      show: {
        client: {
          id: clientId,
          agencyId: ctx.agencyId,
        },
      },
    },
  };
  if (filters.platform) where.platform = filters.platform;
  if (filters.status) where.status = filters.status;
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: endOfDay(filters.to) } : {}),
    };
  }
  return where;
}

// ============================================================
// Reads
// ============================================================

/**
 * Tenant-scoped client check — the public reads all funnel through this so
 * a cross-tenant `clientId` surfaces as `NotFoundError`, not silent empty
 * rows the caller might mis-interpret as "no deliverables this period."
 */
async function assertClientInTenant(ctx: TenantContext, clientId: string): Promise<void> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, agencyId: ctx.agencyId },
    select: { id: true },
  });
  if (!client) throw new NotFoundError(`Client ${clientId} not found`);
}

export async function listDeliverablesForClient(
  ctx: TenantContext,
  clientId: string,
  raw: ListDeliverablesFilterInput,
): Promise<{ rows: DeliverableRow[]; total: number }> {
  requireReadRole(ctx, READ_ROLES);
  await assertClientInTenant(ctx, clientId);
  const where = buildDeliverablesWhere(ctx, clientId, raw);

  const [rows, total] = await Promise.all([
    prisma.generatedOutput.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: raw.take,
      skip: raw.skip,
      include: {
        episode: { select: { id: true, title: true, recordedAt: true } },
        approvedByMember: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.generatedOutput.count({ where }),
  ]);

  return { rows, total };
}

/**
 * Same query as the paginated list but with no `take`/`skip` cap — used by
 * the CSV export route to stream every row inside the filter window.
 * Caller MUST role-gate before invoking (the CSV route does OWNER/ADMIN).
 */
export async function streamDeliverablesForClient(
  ctx: TenantContext,
  clientId: string,
  filters: Omit<ListDeliverablesFilterInput, "take" | "skip">,
): Promise<DeliverableRow[]> {
  requireReadRole(ctx, READ_ROLES);
  await assertClientInTenant(ctx, clientId);
  const where = buildDeliverablesWhere(ctx, clientId, filters);
  return prisma.generatedOutput.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      episode: { select: { id: true, title: true, recordedAt: true } },
      approvedByMember: { select: { id: true, name: true, email: true } },
    },
  });
}
