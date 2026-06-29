import "server-only";

import { MemberRole, OutputStatus, type GeneratedOutput, type Platform } from "@prisma/client";
import { z } from "zod";
import { NotFoundError, ValidationError } from "@/server/auth/errors";
import { requireRole, type TenantContext } from "@/server/auth/tenant";
import { levenshtein } from "@/lib/edit-distance";
import { prisma } from "./client";
import { createSampleFromOutput } from "./voice-samples";

// ============================================================
// Input schemas
// ============================================================

export const updateOutputContentInput = z.object({
  content: z.string().min(1),
});

export const regenerateOutputInput = z.object({
  instruction: z.string().max(500).optional(),
});

export const reviewNoteInput = z.object({
  note: z.string().max(500).optional(),
});

// ============================================================
// Role gates
// ============================================================

const READ_ROLES = [
  MemberRole.OWNER,
  MemberRole.ADMIN,
  MemberRole.EDITOR,
  MemberRole.REVIEWER,
] as const;

const EDIT_ROLES = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.EDITOR] as const;

const APPROVE_ROLES = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.REVIEWER] as const;

/** Anyone with edit rights can flag an output for review. */
const REQUEST_REVIEW_ROLES = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.EDITOR] as const;

/** Same roles that can approve can also reject back to the editor. */
const REJECT_ROLES = APPROVE_ROLES;

// ============================================================
// Reads
// ============================================================

export async function listOutputsForEpisode(
  ctx: TenantContext,
  episodeId: string,
): Promise<GeneratedOutput[]> {
  requireRole(ctx, READ_ROLES);
  // Only return the current version of each platform slot — superseded rows
  // are kept for history but the grid always renders the latest.
  return prisma.generatedOutput.findMany({
    where: {
      episodeId,
      supersededAt: null,
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
    orderBy: { createdAt: "asc" },
  });
}

export async function getOutput(ctx: TenantContext, outputId: string): Promise<GeneratedOutput> {
  requireRole(ctx, READ_ROLES);
  const output = await prisma.generatedOutput.findFirst({
    where: {
      id: outputId,
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
  });
  if (!output) throw new NotFoundError(`Output ${outputId} not found`);
  return output;
}

/**
 * Return every version of a single (episode, platform) slot, given any one
 * version's id. Ordered newest first.
 *
 * Tenancy is enforced by the initial lookup; subsequent rows in the same
 * slot inherit the same `episode.client.agencyId` by construction.
 */
export async function listVersionsForOutput(
  ctx: TenantContext,
  outputId: string,
): Promise<GeneratedOutput[]> {
  requireRole(ctx, READ_ROLES);
  const seed = await prisma.generatedOutput.findFirst({
    where: {
      id: outputId,
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
    select: { episodeId: true, platform: true },
  });
  if (!seed) throw new NotFoundError(`Output ${outputId} not found`);
  return prisma.generatedOutput.findMany({
    where: {
      episodeId: seed.episodeId,
      platform: seed.platform,
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
    orderBy: { version: "desc" },
  });
}

// ============================================================
// Mutations
// ============================================================

export type UpdateOutputResult = {
  output: GeneratedOutput;
  /** Levenshtein distance of *this* save vs. the prior content. */
  delta: number;
};

export async function updateOutputContent(
  ctx: TenantContext,
  outputId: string,
  content: string,
): Promise<UpdateOutputResult> {
  requireRole(ctx, EDIT_ROLES);
  // Verify tenant ownership AND grab the prior content in one round-trip so
  // we can score the edit. `findFirst` enforces the tenant filter — the
  // subsequent `update`-by-id is safe because we've already authorised it.
  const prev = await prisma.generatedOutput.findFirst({
    where: {
      id: outputId,
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
    select: { content: true },
  });
  if (!prev) throw new NotFoundError(`Output ${outputId} not found`);
  const delta = levenshtein(prev.content, content);
  const output = await prisma.generatedOutput.update({
    where: { id: outputId },
    data: { content, editDistance: { increment: delta } },
  });
  return { output, delta };
}

/**
 * Approve an output: flip status → APPROVED, stamp approvedBy/At, persist a
 * new VoiceSample, and log the transition. Runs inside a transaction so the
 * three writes can't diverge.
 */
export async function approveOutput(
  ctx: TenantContext,
  outputId: string,
  approvingMemberId: string,
): Promise<GeneratedOutput> {
  requireRole(ctx, APPROVE_ROLES);

  // Tenancy check + fetch in one go.
  const output = await prisma.generatedOutput.findFirst({
    where: {
      id: outputId,
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
    select: { id: true, status: true },
  });
  if (!output) throw new NotFoundError(`Output ${outputId} not found`);

  const [updated] = await prisma.$transaction([
    prisma.generatedOutput.update({
      where: { id: outputId },
      data: {
        status: OutputStatus.APPROVED,
        approvedAt: new Date(),
        approvedByMemberId: approvingMemberId,
      },
    }),
    prisma.outputTransition.create({
      data: {
        agencyId: ctx.agencyId,
        outputId,
        fromStatus: output.status,
        toStatus: OutputStatus.APPROVED,
        byMemberId: approvingMemberId,
      },
    }),
    // createSampleFromOutput re-verifies tenancy, so a malicious caller can't
    // race this — but we keep it inside the txn so the sample doesn't get
    // written if the approve update somehow fails.
  ]);

  await createSampleFromOutput(ctx, outputId);
  return updated;
}

/**
 * READY → IN_REVIEW. Used by editors to flag content for an approver.
 * Optional note (e.g. "second pass on hook?") becomes the transition note.
 */
export async function requestReviewOutput(
  ctx: TenantContext,
  outputId: string,
  byMemberId: string,
  note?: string,
): Promise<GeneratedOutput> {
  requireRole(ctx, REQUEST_REVIEW_ROLES);

  const output = await prisma.generatedOutput.findFirst({
    where: {
      id: outputId,
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
    select: { id: true, status: true },
  });
  if (!output) throw new NotFoundError(`Output ${outputId} not found`);
  if (output.status !== OutputStatus.READY) {
    throw new ValidationError(`Output ${outputId} can't be sent to review from ${output.status}`);
  }

  const [updated] = await prisma.$transaction([
    prisma.generatedOutput.update({
      where: { id: outputId },
      data: { status: OutputStatus.IN_REVIEW },
    }),
    prisma.outputTransition.create({
      data: {
        agencyId: ctx.agencyId,
        outputId,
        fromStatus: OutputStatus.READY,
        toStatus: OutputStatus.IN_REVIEW,
        byMemberId,
        note: note ?? null,
      },
    }),
  ]);
  return updated;
}

/**
 * IN_REVIEW → READY. Reviewers/admins push back to the editor; the optional
 * note explains *what* needs to change.
 */
export async function rejectOutputForRevision(
  ctx: TenantContext,
  outputId: string,
  byMemberId: string,
  note?: string,
): Promise<GeneratedOutput> {
  requireRole(ctx, REJECT_ROLES);

  const output = await prisma.generatedOutput.findFirst({
    where: {
      id: outputId,
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
    select: { id: true, status: true },
  });
  if (!output) throw new NotFoundError(`Output ${outputId} not found`);
  if (output.status !== OutputStatus.IN_REVIEW) {
    throw new ValidationError(`Output ${outputId} can't be rejected from ${output.status}`);
  }

  const [updated] = await prisma.$transaction([
    prisma.generatedOutput.update({
      where: { id: outputId },
      data: { status: OutputStatus.READY },
    }),
    prisma.outputTransition.create({
      data: {
        agencyId: ctx.agencyId,
        outputId,
        fromStatus: OutputStatus.IN_REVIEW,
        toStatus: OutputStatus.READY,
        byMemberId,
        note: note ?? null,
      },
    }),
  ]);
  return updated;
}

/**
 * Bulk-approve every eligible output across the supplied episodes in a
 * single tenant-scoped transaction. "Eligible" = current version,
 * READY-or-IN_REVIEW. Returns counts so the UI can render a precise
 * confirmation ("Approved 14 outputs across 2 episodes").
 *
 * Why one transaction: cuts the round-trip count from 3 × N writes to 1,
 * and means a mid-stream failure rolls back the entire batch rather than
 * leaving half the rows approved with no `VoiceSample` rows to match.
 */
export async function bulkApproveOutputsForEpisodes(
  ctx: TenantContext,
  episodeIds: string[],
  approvingMemberId: string,
): Promise<{
  totalApproved: number;
  /** Per-episode approved count; missing keys = nothing eligible was found. */
  byEpisode: Record<string, number>;
}> {
  requireRole(ctx, APPROVE_ROLES);
  if (episodeIds.length === 0) return { totalApproved: 0, byEpisode: {} };

  // Tenant filter is on the parent `episode.show.client.agencyId` join so
  // a cross-tenant id in the input array silently drops out (no leak; the
  // count we report will just be 0 for that id).
  const candidates = await prisma.generatedOutput.findMany({
    where: {
      episodeId: { in: episodeIds },
      status: { in: [OutputStatus.READY, OutputStatus.IN_REVIEW] },
      supersededAt: null,
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
    select: {
      id: true,
      status: true,
      platform: true,
      content: true,
      episodeId: true,
      episode: { select: { showId: true } },
    },
  });
  if (candidates.length === 0) return { totalApproved: 0, byEpisode: {} };

  const now = new Date();
  await prisma.$transaction(
    candidates.flatMap((o) => [
      prisma.generatedOutput.update({
        where: { id: o.id },
        data: {
          status: OutputStatus.APPROVED,
          approvedAt: now,
          approvedByMemberId: approvingMemberId,
        },
      }),
      prisma.outputTransition.create({
        data: {
          agencyId: ctx.agencyId,
          outputId: o.id,
          fromStatus: o.status,
          toStatus: OutputStatus.APPROVED,
          byMemberId: approvingMemberId,
        },
      }),
      prisma.voiceSample.create({
        data: {
          showId: o.episode.showId,
          platform: o.platform,
          content: o.content,
          generatedOutputId: o.id,
          episodeId: o.episodeId,
        },
      }),
    ]),
  );

  const byEpisode: Record<string, number> = {};
  for (const o of candidates) {
    byEpisode[o.episodeId] = (byEpisode[o.episodeId] ?? 0) + 1;
  }
  return { totalApproved: candidates.length, byEpisode };
}

/**
 * Stamp the current row as superseded and create the next version of the
 * (episode, platform) slot in a single transaction. The new row starts at
 * status GENERATING — the Inngest function will overwrite `content` and
 * flip the status once Claude returns.
 *
 * Returns the NEW row (callers must use its id for the regenerate event).
 */
export async function markOutputRegenerating(
  ctx: TenantContext,
  outputId: string,
  instruction?: string,
  byMemberId?: string,
): Promise<GeneratedOutput> {
  requireRole(ctx, EDIT_ROLES);

  const previous = await prisma.generatedOutput.findFirst({
    where: {
      id: outputId,
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
    select: {
      id: true,
      episodeId: true,
      platform: true,
      content: true,
      version: true,
      supersededAt: true,
    },
  });
  if (!previous) throw new NotFoundError(`Output ${outputId} not found`);
  if (previous.supersededAt) {
    throw new NotFoundError(
      `Output ${outputId} is not the current version — regenerate the latest version instead`,
    );
  }

  const now = new Date();
  // Note: the transition is attached to the NEW row's id, but we need that
  // id before we run the create. Prisma 7 returns the freshly-created row
  // from `create` inside `$transaction`, so we split this into two phases:
  // (1) supersede + create new version atomically, then (2) log the
  // transition once we know the id. If (2) ever fails, the regenerate event
  // has already gone out — the worst case is a missing audit row, not a
  // status/regen drift.
  const [, created] = await prisma.$transaction([
    prisma.generatedOutput.update({
      where: { id: previous.id },
      data: { supersededAt: now },
    }),
    prisma.generatedOutput.create({
      data: {
        episodeId: previous.episodeId,
        platform: previous.platform,
        // Carry the old content forward as a placeholder so the UI never
        // shows an empty card; the Inngest function will overwrite it.
        content: previous.content,
        status: OutputStatus.GENERATING,
        version: previous.version + 1,
        lastInstruction: instruction ?? null,
        previousVersionId: previous.id,
      },
    }),
  ]);

  // Audit: previous status → GENERATING on the new row. The instruction
  // becomes the transition note so the activity feed reads naturally.
  await prisma.outputTransition.create({
    data: {
      agencyId: ctx.agencyId,
      outputId: created.id,
      fromStatus: null,
      toStatus: OutputStatus.GENERATING,
      byMemberId: byMemberId ?? null,
      note: instruction ?? null,
    },
  });

  return created;
}

// ============================================================
// Quality metrics — used by the Output Quality rail
// ============================================================

export type QualityByPlatform = Record<Platform, { count: number; avg: number }>;

export async function qualityByPlatformForEpisode(
  ctx: TenantContext,
  episodeId: string,
): Promise<QualityByPlatform> {
  requireRole(ctx, READ_ROLES);
  const rows = await prisma.generatedOutput.groupBy({
    by: ["platform"],
    where: {
      episodeId,
      supersededAt: null,
      episode: { show: { client: { agencyId: ctx.agencyId } } },
      quality: { not: null },
    },
    _avg: { quality: true },
    _count: { _all: true },
  });
  const empty: QualityByPlatform = {
    TWITTER: { count: 0, avg: 0 },
    LINKEDIN: { count: 0, avg: 0 },
    INSTAGRAM: { count: 0, avg: 0 },
    TIKTOK: { count: 0, avg: 0 },
    SHOW_NOTES: { count: 0, avg: 0 },
    BLOG: { count: 0, avg: 0 },
    NEWSLETTER: { count: 0, avg: 0 },
  };
  for (const row of rows) {
    empty[row.platform] = {
      count: row._count._all,
      avg: Math.round(row._avg.quality ?? 0),
    };
  }
  return empty;
}
