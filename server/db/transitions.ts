import "server-only";

import { MemberRole, type OutputStatus, type OutputTransition, type Prisma } from "@prisma/client";
import { NotFoundError } from "@/server/auth/errors";
import { requireRole, type TenantContext } from "@/server/auth/tenant";
import { prisma } from "./client";

const READ_ROLES = [
  MemberRole.OWNER,
  MemberRole.ADMIN,
  MemberRole.EDITOR,
  MemberRole.REVIEWER,
] as const;

export type RecordTransitionInput = {
  outputId: string;
  fromStatus: OutputStatus | null;
  toStatus: OutputStatus;
  /** Acting member; null for system-driven pipeline transitions. */
  byMemberId: string | null;
  note?: string | null;
};

/**
 * Resolve the agencyId for an output and emit a transition row.
 *
 * Returns a Prisma `create` operation rather than executing it, so callers can
 * splice the write into a `$transaction` alongside the status update — that
 * way the log can never drift from the status it claims to record.
 */
export async function buildTransitionWrite(
  agencyId: string,
  input: RecordTransitionInput,
): Promise<Prisma.PrismaPromise<OutputTransition>> {
  return prisma.outputTransition.create({
    data: {
      agencyId,
      outputId: input.outputId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      byMemberId: input.byMemberId,
      note: input.note ?? null,
    },
  });
}

/**
 * Standalone helper for the rare case where there's no transaction to splice
 * into (e.g. ad-hoc backfill scripts).
 */
export async function recordTransition(
  ctx: TenantContext,
  input: RecordTransitionInput,
): Promise<OutputTransition> {
  // Tenancy check via the output.
  const output = await prisma.generatedOutput.findFirst({
    where: {
      id: input.outputId,
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
    select: { id: true },
  });
  if (!output) throw new NotFoundError(`Output ${input.outputId} not found`);

  return prisma.outputTransition.create({
    data: {
      agencyId: ctx.agencyId,
      outputId: input.outputId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      byMemberId: input.byMemberId,
      note: input.note ?? null,
    },
  });
}

export type TransitionWithContext = OutputTransition & {
  member: { name: string | null; email: string } | null;
  output: {
    platform: string;
    episode: {
      title: string;
      show: { name: string; client: { name: string } };
    };
  };
};

/**
 * Latest N transitions for the dashboard activity feed. Single-table read on
 * `OutputTransition` filtered by `agencyId`, with the minimum fan-out needed
 * to render an activity row (acting member, platform, episode + client name).
 */
export async function listRecentTransitions(
  ctx: TenantContext,
  limit = 12,
): Promise<TransitionWithContext[]> {
  requireRole(ctx, READ_ROLES);
  return prisma.outputTransition.findMany({
    where: { agencyId: ctx.agencyId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      member: { select: { name: true, email: true } },
      output: {
        select: {
          platform: true,
          episode: {
            select: {
              title: true,
              show: {
                select: {
                  name: true,
                  client: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  });
}
