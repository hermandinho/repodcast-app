import "server-only";

import {
  ExternalScheduler,
  MemberRole,
  OutputStatus,
  type GeneratedOutput,
  type Platform,
} from "@prisma/client";
import { z } from "zod";
import { NotFoundError, ValidationError } from "@/server/auth/errors";
import { requireReadRole, requireRole, type TenantContext } from "@/server/auth/tenant";
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
  requireReadRole(ctx, READ_ROLES);
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
  requireReadRole(ctx, READ_ROLES);
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
  requireReadRole(ctx, READ_ROLES);
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
// Phase 3.3 — Scheduling helpers
// ============================================================

/** Roles allowed to schedule, unschedule, and mark-published outputs. */
const SCHEDULE_ROLES = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.EDITOR] as const;

export const scheduleOutputInput = z.object({
  scheduledFor: z.coerce.date(),
  externalScheduler: z.nativeEnum(ExternalScheduler),
  externalPostId: z.string().min(1).optional(),
  externalPostUrl: z.string().url().optional(),
});

/**
 * APPROVED → SCHEDULED. The mode is provided by the caller after they've
 * decided (based on Buffer availability + platform support) which backend
 * takes this post. For Buffer-backed rows, the caller has already pushed
 * to Buffer and passes the resulting update id + public URL.
 *
 * `scheduledFor` must be in the future — back-dating is what
 * `markOutputPublished` is for.
 */
export async function scheduleOutput(
  ctx: TenantContext,
  outputId: string,
  memberId: string,
  input: z.infer<typeof scheduleOutputInput>,
): Promise<GeneratedOutput> {
  requireRole(ctx, SCHEDULE_ROLES);

  const output = await prisma.generatedOutput.findFirst({
    where: {
      id: outputId,
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
    select: { id: true, status: true, supersededAt: true },
  });
  if (!output) throw new NotFoundError(`Output ${outputId} not found`);
  if (output.supersededAt) {
    throw new ValidationError(
      `Output ${outputId} is a superseded version — schedule the current one.`,
    );
  }
  if (output.status !== OutputStatus.APPROVED) {
    throw new ValidationError(
      `Output ${outputId} can't be scheduled from status ${output.status} — approve it first.`,
    );
  }
  if (input.scheduledFor.getTime() <= Date.now()) {
    throw new ValidationError("`scheduledFor` must be in the future.");
  }

  const [updated] = await prisma.$transaction([
    prisma.generatedOutput.update({
      where: { id: outputId },
      data: {
        status: OutputStatus.SCHEDULED,
        scheduledFor: input.scheduledFor,
        scheduledByMemberId: memberId,
        externalScheduler: input.externalScheduler,
        externalPostId: input.externalPostId ?? null,
        externalPostUrl: input.externalPostUrl ?? null,
      },
    }),
    prisma.outputTransition.create({
      data: {
        agencyId: ctx.agencyId,
        outputId,
        fromStatus: OutputStatus.APPROVED,
        toStatus: OutputStatus.SCHEDULED,
        byMemberId: memberId,
        note: `Scheduled via ${input.externalScheduler} for ${input.scheduledFor.toISOString()}`,
      },
    }),
  ]);
  return updated;
}

/**
 * SCHEDULED → APPROVED. Clears every scheduling column. Callers are
 * responsible for tearing down the external post first (e.g. Buffer's
 * `deleteUpdate`).
 */
export async function unscheduleOutput(
  ctx: TenantContext,
  outputId: string,
  memberId: string,
): Promise<GeneratedOutput> {
  requireRole(ctx, SCHEDULE_ROLES);

  const output = await prisma.generatedOutput.findFirst({
    where: {
      id: outputId,
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
    select: { id: true, status: true },
  });
  if (!output) throw new NotFoundError(`Output ${outputId} not found`);
  if (output.status !== OutputStatus.SCHEDULED) {
    throw new ValidationError(
      `Output ${outputId} can't be unscheduled from status ${output.status}.`,
    );
  }

  const [updated] = await prisma.$transaction([
    prisma.generatedOutput.update({
      where: { id: outputId },
      data: {
        status: OutputStatus.APPROVED,
        scheduledFor: null,
        scheduledByMemberId: null,
        externalScheduler: null,
        externalPostId: null,
        externalPostUrl: null,
      },
    }),
    prisma.outputTransition.create({
      data: {
        agencyId: ctx.agencyId,
        outputId,
        fromStatus: OutputStatus.SCHEDULED,
        toStatus: OutputStatus.APPROVED,
        byMemberId: memberId,
      },
    }),
  ]);
  return updated;
}

export const markPublishedInput = z.object({
  publishedAt: z.coerce.date().optional(),
  externalPostUrl: z.string().url().optional(),
});

/**
 * SCHEDULED → PUBLISHED. Called by:
 *   - The user hitting "Mark published" on a MANUAL-mode row (memberId set,
 *     optional externalPostUrl for pasting the live-post URL after the fact).
 *   - The `sync-scheduled-outputs` cron when Buffer confirms delivery
 *     (memberId null, publishedAt from Buffer's `sent_at`).
 *
 * `memberId = null` is the cron-driven case; the transition row records it
 * as a system-driven flip.
 */
export async function markOutputPublished(
  ctx: TenantContext,
  outputId: string,
  memberId: string | null,
  input: z.infer<typeof markPublishedInput>,
): Promise<GeneratedOutput> {
  // Human path enforces role; cron path skips (Inngest fn has its own gate).
  if (memberId !== null) {
    requireRole(ctx, SCHEDULE_ROLES);
  }

  const output = await prisma.generatedOutput.findFirst({
    where: {
      id: outputId,
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
    select: { id: true, status: true, externalPostUrl: true },
  });
  if (!output) throw new NotFoundError(`Output ${outputId} not found`);
  if (output.status !== OutputStatus.SCHEDULED) {
    throw new ValidationError(
      `Output ${outputId} can't be marked published from status ${output.status}.`,
    );
  }

  const publishedAt = input.publishedAt ?? new Date();
  const nextUrl = input.externalPostUrl ?? output.externalPostUrl;

  const [updated] = await prisma.$transaction([
    prisma.generatedOutput.update({
      where: { id: outputId },
      data: {
        status: OutputStatus.PUBLISHED,
        publishedAt,
        externalPostUrl: nextUrl,
      },
    }),
    prisma.outputTransition.create({
      data: {
        agencyId: ctx.agencyId,
        outputId,
        fromStatus: OutputStatus.SCHEDULED,
        toStatus: OutputStatus.PUBLISHED,
        byMemberId: memberId,
      },
    }),
  ]);
  return updated;
}

export type CalendarOutput = {
  id: string;
  episodeId: string;
  episodeTitle: string;
  clientId: string;
  clientHost: string;
  showId: string;
  showTitle: string;
  platform: Platform;
  content: string;
  status: OutputStatus;
  scheduledFor: Date | null;
  publishedAt: Date | null;
  externalScheduler: ExternalScheduler | null;
  externalPostUrl: string | null;
};

export const listScheduledOutputsInput = z.object({
  fromIso: z.string().datetime(),
  toIso: z.string().datetime(),
  clientId: z.string().min(1).optional(),
  showId: z.string().min(1).optional(),
  platform: z.string().min(1).optional(),
});

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Calendar range read. Includes SCHEDULED (in-flight) + PUBLISHED (past),
 * bounded to a 90-day window so a naive `?fromIso=1970-01-01` doesn't scan
 * the world. Only current versions (`supersededAt: null`).
 */
export async function listScheduledOutputsForAgency(
  ctx: TenantContext,
  input: z.infer<typeof listScheduledOutputsInput>,
): Promise<CalendarOutput[]> {
  requireReadRole(ctx, READ_ROLES);
  const from = new Date(input.fromIso);
  const to = new Date(input.toIso);
  if (to.getTime() <= from.getTime()) {
    throw new ValidationError("`toIso` must be after `fromIso`.");
  }
  if (to.getTime() - from.getTime() > NINETY_DAYS_MS) {
    throw new ValidationError("Calendar window is capped at 90 days.");
  }

  const rows = await prisma.generatedOutput.findMany({
    where: {
      supersededAt: null,
      status: { in: [OutputStatus.SCHEDULED, OutputStatus.PUBLISHED] },
      OR: [{ scheduledFor: { gte: from, lt: to } }, { publishedAt: { gte: from, lt: to } }],
      episode: {
        show: {
          client: {
            agencyId: ctx.agencyId,
            ...(input.clientId ? { id: input.clientId } : {}),
          },
          ...(input.showId ? { id: input.showId } : {}),
        },
      },
      ...(input.platform ? { platform: input.platform as Platform } : {}),
    },
    orderBy: [{ scheduledFor: "asc" }, { publishedAt: "asc" }],
    include: {
      episode: {
        select: {
          title: true,
          showId: true,
          show: {
            select: {
              name: true,
              host: true,
              client: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    episodeId: r.episodeId,
    episodeTitle: r.episode.title,
    clientId: r.episode.show.client.id,
    clientHost: r.episode.show.host,
    showId: r.episode.showId,
    showTitle: r.episode.show.name,
    platform: r.platform,
    content: r.content,
    status: r.status,
    scheduledFor: r.scheduledFor,
    publishedAt: r.publishedAt,
    externalScheduler: r.externalScheduler,
    externalPostUrl: r.externalPostUrl,
  }));
}

/**
 * Cron-side scan: every SCHEDULED row currently in flight, across all
 * agencies. Bounded to 500 rows per pass; the cron loops until empty.
 */
export async function listInFlightScheduledOutputs(limit = 500): Promise<
  Array<{
    id: string;
    agencyId: string;
    platform: Platform;
    scheduledFor: Date;
    externalScheduler: ExternalScheduler;
    externalPostId: string | null;
    createdAt: Date;
  }>
> {
  const rows = await prisma.generatedOutput.findMany({
    where: {
      status: OutputStatus.SCHEDULED,
      supersededAt: null,
    },
    orderBy: { scheduledFor: "asc" },
    take: limit,
    select: {
      id: true,
      platform: true,
      scheduledFor: true,
      externalScheduler: true,
      externalPostId: true,
      createdAt: true,
      episode: { select: { show: { select: { client: { select: { agencyId: true } } } } } },
    },
  });
  return rows
    .filter((r) => r.scheduledFor !== null && r.externalScheduler !== null)
    .map((r) => ({
      id: r.id,
      agencyId: r.episode.show.client.agencyId,
      platform: r.platform,
      scheduledFor: r.scheduledFor!,
      externalScheduler: r.externalScheduler!,
      externalPostId: r.externalPostId,
      createdAt: r.createdAt,
    }));
}

// ============================================================
// Quality metrics — used by the Output Quality rail
// ============================================================

export type QualityByPlatform = Record<Platform, { count: number; avg: number }>;

export async function qualityByPlatformForEpisode(
  ctx: TenantContext,
  episodeId: string,
): Promise<QualityByPlatform> {
  requireReadRole(ctx, READ_ROLES);
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
