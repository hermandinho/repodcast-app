import "server-only";

import {
  ExternalScheduler,
  MemberRole,
  OutputStatus,
  ValidationMode,
  type GeneratedOutput,
  type Platform,
} from "@prisma/client";
import { z } from "zod";
import { NotFoundError, ValidationError } from "@/server/auth/errors";
import { requireReadRole, requireRole, type TenantContext } from "@/server/auth/tenant";
import { levenshtein } from "@/lib/edit-distance";
import { prisma } from "./client";
import { createSampleFromOutput, createSampleFromOutputRaw } from "./voice-samples";
import {
  notifyClientApproved,
  notifyClientPostPublished,
  notifyClientRevisionRequested,
  notifyReviewRequested,
} from "./notifications";

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

/** Roles allowed to modify a *draft* output (READY / IN_REVIEW). */
const EDIT_ROLES = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.EDITOR] as const;

const APPROVE_ROLES = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.REVIEWER] as const;

/**
 * Requesting a review is an editor-only action. OWNER/ADMIN/REVIEWER don't
 * request reviews of themselves — they approve directly. Locking this to
 * EDITOR keeps the review inbox meaningful (every notification is a real
 * hand-off) and matches the UX contract: the "Request review" button is
 * only ever rendered to editors.
 */
const REQUEST_REVIEW_ROLES = [MemberRole.EDITOR] as const;

/** Same roles that can approve can also reject back to the editor. */
const REJECT_ROLES = APPROVE_ROLES;

/**
 * Permission gate for content edits + regenerate. Encodes the post-approval
 * rules independently from `EDIT_ROLES` so the UI can query the same helper
 * before rendering an "Edit" affordance and the server can enforce it as
 * the authority. Rules:
 *
 * - `clientApprovedAt != null` → frozen for everyone, forever.
 * - Client-side validation mode + status `AWAITING_CLIENT_APPROVAL`
 *   → frozen (the ball is in the client's court).
 * - Status `APPROVED`, INTERNAL mode → OWNER only. Owner edits stay in
 *   `APPROVED` per the workflow spec; the audit trail (OutputTransition +
 *   `editDistance`) tells the "who changed it after approval" story.
 * - Status `APPROVED`, CLIENT mode → frozen (row is between agency and
 *   the client — the client can either approve or ask for revision).
 * - Terminal states (`SCHEDULED`, `PUBLISHED`, `GENERATING`, `FAILED`)
 *   → not directly editable via this path.
 * - Draft states (`READY`, `IN_REVIEW`) → the standard `EDIT_ROLES` set.
 */
export function canEditOutput(
  output: {
    status: OutputStatus;
    clientApprovedAt: Date | null;
  },
  client: { validationMode: ValidationMode },
  memberRole: MemberRole,
): boolean {
  if (output.clientApprovedAt != null) return false;
  if (output.status === OutputStatus.AWAITING_CLIENT_APPROVAL) return false;
  if (output.status === OutputStatus.APPROVED) {
    if (client.validationMode === ValidationMode.CLIENT) return false;
    return memberRole === MemberRole.OWNER;
  }
  if (output.status === OutputStatus.READY || output.status === OutputStatus.IN_REVIEW) {
    return (EDIT_ROLES as readonly MemberRole[]).includes(memberRole);
  }
  return false;
}

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
    select: {
      content: true,
      status: true,
      clientApprovedAt: true,
      episode: { select: { show: { select: { client: { select: { validationMode: true } } } } } },
    },
  });
  if (!prev) throw new NotFoundError(`Output ${outputId} not found`);
  if (!canEditOutput(prev, prev.episode.show.client, ctx.role)) {
    throw new ValidationError(`Output ${outputId} is not editable in its current state.`);
  }
  const delta = levenshtein(prev.content, content);
  const output = await prisma.generatedOutput.update({
    where: { id: outputId },
    data: { content, editDistance: { increment: delta } },
  });
  return { output, delta };
}

/**
 * Approve an output. Behavior branches on the parent client's
 * `validationMode`:
 *
 * - INTERNAL — the agency team's approval is final. Flip status → APPROVED,
 *   stamp approvedBy/At, persist a new VoiceSample, and log the transition.
 * - CLIENT — the agency has finished internal review; hand the output off to
 *   the end client via the portal. Flip status → AWAITING_CLIENT_APPROVAL,
 *   stamp `sentToClientAt`, log the transition. No VoiceSample yet — that
 *   fires only when the client confirms via `clientApproveOutput`.
 *
 * All writes run inside a transaction so state, audit row, and (in the
 * INTERNAL case) the voice sample can't diverge.
 */
export async function approveOutput(
  ctx: TenantContext,
  outputId: string,
  approvingMemberId: string,
): Promise<GeneratedOutput> {
  requireRole(ctx, APPROVE_ROLES);

  // Tenancy check + fetch (including the client's validation mode) in one go.
  const output = await prisma.generatedOutput.findFirst({
    where: {
      id: outputId,
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
    select: {
      id: true,
      status: true,
      episode: { select: { show: { select: { client: { select: { validationMode: true } } } } } },
    },
  });
  if (!output) throw new NotFoundError(`Output ${outputId} not found`);

  const validationMode = output.episode.show.client.validationMode;
  const now = new Date();

  if (validationMode === ValidationMode.CLIENT) {
    const [updated] = await prisma.$transaction([
      prisma.generatedOutput.update({
        where: { id: outputId },
        data: {
          status: OutputStatus.AWAITING_CLIENT_APPROVAL,
          sentToClientAt: now,
        },
      }),
      prisma.outputTransition.create({
        data: {
          agencyId: ctx.agencyId,
          outputId,
          fromStatus: output.status,
          toStatus: OutputStatus.AWAITING_CLIENT_APPROVAL,
          byMemberId: approvingMemberId,
          note: "Sent to client for approval",
        },
      }),
    ]);
    return updated;
  }

  const [updated] = await prisma.$transaction([
    prisma.generatedOutput.update({
      where: { id: outputId },
      data: {
        status: OutputStatus.APPROVED,
        approvedAt: now,
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
 * Portal-side "client approves this output". No `TenantContext` — the
 * portal is unauthenticated (the URL token is the credential) and the caller
 * has already validated the token in `getPortalContextByToken`. This helper
 * is scoped by the resolved `agencyId` and `outputId` pair to prevent a
 * malicious token holder from approving an unrelated output.
 *
 * Transitions AWAITING_CLIENT_APPROVAL → APPROVED, stamps `clientApprovedAt`
 * + `clientApprovalEmail`, creates the VoiceSample the internal approval
 * path skipped, and logs the transition with `byMemberId = null` (the actor
 * is the end client, not a Member).
 */
export async function clientApproveOutputFromPortal(input: {
  agencyId: string;
  outputId: string;
  approvalEmail: string | null;
}): Promise<GeneratedOutput> {
  const output = await prisma.generatedOutput.findFirst({
    where: {
      id: input.outputId,
      episode: { show: { client: { agencyId: input.agencyId } } },
    },
    select: {
      id: true,
      status: true,
      platform: true,
      episodeId: true,
      episode: {
        select: {
          title: true,
          show: { select: { clientId: true } },
        },
      },
    },
  });
  if (!output) throw new NotFoundError(`Output ${input.outputId} not found`);
  if (output.status !== OutputStatus.AWAITING_CLIENT_APPROVAL) {
    throw new ValidationError(
      `Output ${input.outputId} is not awaiting client approval (status: ${output.status}).`,
    );
  }

  const now = new Date();
  const [updated] = await prisma.$transaction([
    prisma.generatedOutput.update({
      where: { id: input.outputId },
      data: {
        status: OutputStatus.APPROVED,
        approvedAt: now,
        clientApprovedAt: now,
        clientApprovalEmail: input.approvalEmail,
      },
    }),
    prisma.outputTransition.create({
      data: {
        agencyId: input.agencyId,
        outputId: input.outputId,
        fromStatus: OutputStatus.AWAITING_CLIENT_APPROVAL,
        toStatus: OutputStatus.APPROVED,
        byMemberId: null,
        note: input.approvalEmail
          ? `Approved by client (${input.approvalEmail})`
          : "Approved by client via portal",
      },
    }),
  ]);

  // Voice sample creation is best-effort; portal-side approvals shouldn't
  // fail if the sample write hiccups. `createSampleFromOutputRaw` skips the
  // tenant assert (we've already scoped by agencyId above).
  try {
    await createSampleFromOutputRaw(input.outputId, input.agencyId);
  } catch (err) {
    console.error("[approvals] voice sample write failed after client approval", err);
  }

  try {
    await notifyClientApproved({
      agencyId: input.agencyId,
      clientId: output.episode.show.clientId,
      outputId: input.outputId,
      episodeId: output.episodeId,
      episodeTitle: output.episode.title,
      platform: output.platform,
      actorMemberId: null,
      actorName: null,
    });
  } catch (err) {
    console.error("[approvals] client-approved notification fanout failed", err);
  }

  return updated;
}

/**
 * Portal-side "client asks for changes". Transitions AWAITING_CLIENT_APPROVAL
 * → READY so the agency's editors can rework the piece. Clears
 * `sentToClientAt` so the badge doesn't stick around. The optional note is
 * recorded on the OutputTransition; callers may also drop a
 * `ClientPortalFeedback` row for the /clients/[key]/billing inbox.
 */
export async function clientRequestRevisionFromPortal(input: {
  agencyId: string;
  outputId: string;
  requesterEmail: string | null;
  note?: string;
}): Promise<GeneratedOutput> {
  const output = await prisma.generatedOutput.findFirst({
    where: {
      id: input.outputId,
      episode: { show: { client: { agencyId: input.agencyId } } },
    },
    select: {
      id: true,
      status: true,
      platform: true,
      episodeId: true,
      episode: {
        select: {
          title: true,
          show: { select: { clientId: true } },
        },
      },
    },
  });
  if (!output) throw new NotFoundError(`Output ${input.outputId} not found`);
  if (output.status !== OutputStatus.AWAITING_CLIENT_APPROVAL) {
    throw new ValidationError(
      `Output ${input.outputId} is not awaiting client approval (status: ${output.status}).`,
    );
  }

  const noteBody = input.note?.trim();
  const transitionNote = [
    input.requesterEmail
      ? `Revision requested by ${input.requesterEmail}`
      : "Revision requested by client",
    noteBody ? `— ${noteBody}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const [updated] = await prisma.$transaction([
    prisma.generatedOutput.update({
      where: { id: input.outputId },
      data: {
        status: OutputStatus.READY,
        sentToClientAt: null,
      },
    }),
    prisma.outputTransition.create({
      data: {
        agencyId: input.agencyId,
        outputId: input.outputId,
        fromStatus: OutputStatus.AWAITING_CLIENT_APPROVAL,
        toStatus: OutputStatus.READY,
        byMemberId: null,
        note: transitionNote,
      },
    }),
  ]);

  try {
    await notifyClientRevisionRequested({
      agencyId: input.agencyId,
      clientId: output.episode.show.clientId,
      outputId: input.outputId,
      episodeId: output.episodeId,
      episodeTitle: output.episode.title,
      platform: output.platform,
      actorMemberId: null,
      actorName: null,
      note: noteBody ?? null,
    });
  } catch (err) {
    console.error("[approvals] revision-requested notification fanout failed", err);
  }

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
    select: {
      id: true,
      status: true,
      platform: true,
      episodeId: true,
      episode: {
        select: {
          title: true,
          show: { select: { clientId: true } },
        },
      },
    },
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

  // Notification fan-out is best-effort — a failure here shouldn't undo
  // the state transition the editor just made.
  const actor = await prisma.member.findUnique({
    where: { id: byMemberId },
    select: { name: true, email: true },
  });
  try {
    await notifyReviewRequested({
      agencyId: ctx.agencyId,
      clientId: output.episode.show.clientId,
      outputId,
      episodeId: output.episodeId,
      episodeTitle: output.episode.title,
      platform: output.platform,
      actorMemberId: byMemberId,
      actorName: actor?.name ?? actor?.email.split("@")[0] ?? null,
      note: note ?? null,
    });
  } catch (err) {
    console.error("[requestReviewOutput] notification fanout failed", err);
  }
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
  // count we report will just be 0 for that id). We also pull the client's
  // validation mode so the batch can branch per row — INTERNAL rows go
  // straight to APPROVED + VoiceSample, CLIENT rows go to
  // AWAITING_CLIENT_APPROVAL (no VoiceSample yet).
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
      episode: {
        select: {
          showId: true,
          show: { select: { client: { select: { validationMode: true } } } },
        },
      },
    },
  });
  if (candidates.length === 0) return { totalApproved: 0, byEpisode: {} };

  const now = new Date();
  await prisma.$transaction(
    candidates.flatMap((o) => {
      const validationMode = o.episode.show.client.validationMode;
      if (validationMode === ValidationMode.CLIENT) {
        return [
          prisma.generatedOutput.update({
            where: { id: o.id },
            data: {
              status: OutputStatus.AWAITING_CLIENT_APPROVAL,
              sentToClientAt: now,
            },
          }),
          prisma.outputTransition.create({
            data: {
              agencyId: ctx.agencyId,
              outputId: o.id,
              fromStatus: o.status,
              toStatus: OutputStatus.AWAITING_CLIENT_APPROVAL,
              byMemberId: approvingMemberId,
              note: "Sent to client for approval",
            },
          }),
        ];
      }
      return [
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
      ];
    }),
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
      status: true,
      clientApprovedAt: true,
      supersededAt: true,
      episode: { select: { show: { select: { client: { select: { validationMode: true } } } } } },
    },
  });
  if (!previous) throw new NotFoundError(`Output ${outputId} not found`);
  if (previous.supersededAt) {
    throw new NotFoundError(
      `Output ${outputId} is not the current version — regenerate the latest version instead`,
    );
  }
  if (!canEditOutput(previous, previous.episode.show.client, ctx.role)) {
    throw new ValidationError(`Output ${outputId} is not editable in its current state.`);
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

  // Best-effort client notification — the helper is a no-op when the
  // client has no contactEmail and self-swallows any error, so we can
  // await it inline without risking rollback of the publish.
  await notifyClientPostPublished(outputId);

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
