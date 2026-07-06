import "server-only";

import {
  EpisodeStatus,
  MemberRole,
  Plan,
  Platform,
  type Prisma,
  TranscriptSource,
  type Episode,
} from "@prisma/client";
import { z } from "zod";
import { NotFoundError } from "@/server/auth/errors";
import { requireReadRole, requireRole, type TenantContext } from "@/server/auth/tenant";
import { assertMinPlan, assertPlanCapacity, getAgencyPlan } from "@/server/billing/limits";
import { prisma } from "./client";

/** Default platform set used by batch-generate when an episode has no
 *  prior outputs to derive from (FAILED before any output was created). */
const ALL_PLATFORMS: Platform[] = [
  Platform.TWITTER,
  Platform.LINKEDIN,
  Platform.INSTAGRAM,
  Platform.TIKTOK,
  Platform.SHOW_NOTES,
  Platform.BLOG,
  Platform.NEWSLETTER,
];

// ============================================================
// Input schemas
// ============================================================

/**
 * Attention-based bucket filter that lives alongside the raw `status`
 * filter. Needed because `Episode.status` only tracks the generation
 * pipeline (DRAFT → PROCESSING → READY / FAILED) and never advances past
 * READY as outputs get approved / scheduled / published. So a query like
 * "show me episodes needing review" can't be expressed via `status`
 * alone — it has to reach into `GeneratedOutput.status`.
 *
 * - `review` — at least one current (non-superseded) output sits in a
 *   reviewable status (READY / IN_REVIEW / AWAITING_CLIENT_APPROVAL).
 * - `drafts` — status DRAFT, or an episode with no outputs yet.
 * - `done`  — has outputs but nothing pending review; every current
 *   output is APPROVED / SCHEDULED / PUBLISHED / FAILED (or the episode
 *   is ARCHIVED).
 */
export const episodeBucketFilter = z.enum(["review", "drafts", "done"]);
export type EpisodeBucketFilter = z.infer<typeof episodeBucketFilter>;

export const listEpisodesFilterInput = z.object({
  /** Case-insensitive substring match on Episode.title. */
  search: z.string().trim().max(200).optional(),
  status: z.nativeEnum(EpisodeStatus).optional(),
  bucket: episodeBucketFilter.optional(),
  showId: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  /** Inclusive lower bound on `Episode.createdAt`. */
  from: z.coerce.date().optional(),
  /** Inclusive upper bound on `Episode.createdAt`. */
  to: z.coerce.date().optional(),
  take: z.number().int().min(1).max(100).default(25),
  skip: z.number().int().min(0).default(0),
});
export type ListEpisodesFilterInput = z.infer<typeof listEpisodesFilterInput>;

/** OutputStatuses that count an output as "pending review". Shared by
 *  `episodeBucketTotals`, the paged-list `pendingReviewCount` join, and
 *  the `bucket=review` where-clause translation. */
const PENDING_REVIEW_STATUSES = ["READY", "IN_REVIEW", "AWAITING_CLIENT_APPROVAL"] as const;

export const createEpisodeInput = z
  .object({
    /**
     * Optional caller-supplied id. Used by the audio-upload flow so the
     * R2 object key (which embeds the episodeId) and the Episode row
     * share an id without a rename. Defaults to Prisma's `cuid()` when
     * omitted.
     */
    id: z.string().min(1).optional(),
    showId: z.string().min(1),
    title: z.string().min(1).max(240),
    /**
     * Empty string is allowed for non-PASTE sources — the transcribe
     * pipeline fills it in. The ≥ 500-char floor is enforced only for
     * PASTE in the `.superRefine` below so the wizard's audio/RSS/
     * YouTube branches can submit without a transcript and have it
     * land asynchronously.
     */
    transcript: z.string().default(""),
    source: z.nativeEnum(TranscriptSource),
    /**
     * UPLOAD: R2 object key returned by `signAudioUploadAction`.
     * RSS / YOUTUBE: external download URL. Validation is `.min(1)`
     * (not `.url()`) because R2 keys are not URLs.
     */
    audioUrl: z.string().min(1).nullish(),
    /**
     * Free-form external identifier — Podcast Index GUID for RSS imports
     * (often a UUID, sometimes a URL, sometimes a publisher-local id) or
     * a YouTube video id. Validation is `.min(1)` (not `.url()`) because
     * publisher GUIDs are not URLs.
     */
    externalUrl: z.string().min(1).nullish(),
    recordedAt: z.date().nullish(),
    durationSec: z.number().int().positive().nullish(),
  })
  .superRefine((data, ctx) => {
    if (data.source === TranscriptSource.PASTE && data.transcript.length < 500) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum: 500,
        origin: "string",
        inclusive: true,
        path: ["transcript"],
        message: "Transcript must be at least 500 characters",
      });
    }
    if (data.source === TranscriptSource.UPLOAD && !data.audioUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["audioUrl"],
        message: "Audio file is required for UPLOAD source",
      });
    }
  });
export type CreateEpisodeInput = z.infer<typeof createEpisodeInput>;

// ============================================================
// Role gates
// ============================================================

const READ_ROLES = [
  MemberRole.OWNER,
  MemberRole.ADMIN,
  MemberRole.EDITOR,
  MemberRole.REVIEWER,
] as const;

const WRITE_ROLES = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.EDITOR] as const;

// ============================================================
// Reads — Episodes are tenanted via Show → Client → Agency. Every read
// filters through `show.client.agencyId === ctx.agencyId` so episodes in
// other tenants are invisible regardless of which id the caller hands us.
// ============================================================

export async function listEpisodes(ctx: TenantContext): Promise<Episode[]> {
  requireReadRole(ctx, READ_ROLES);
  return prisma.episode.findMany({
    where: { show: { client: { agencyId: ctx.agencyId } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function listEpisodesForShow(ctx: TenantContext, showId: string): Promise<Episode[]> {
  requireReadRole(ctx, READ_ROLES);
  return prisma.episode.findMany({
    where: {
      showId,
      show: { client: { agencyId: ctx.agencyId } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Build the tenant-scoped `where` clause for the filtered list/count helpers.
 * Tenancy is always enforced via `show.client.agencyId`; optional filters are
 * appended only when set so a fresh `/episodes` view returns everything.
 */
function buildEpisodeListWhere(
  ctx: TenantContext,
  filters: Omit<ListEpisodesFilterInput, "take" | "skip">,
): Prisma.EpisodeWhereInput {
  const clientWhere: Prisma.ClientWhereInput = {
    agencyId: ctx.agencyId,
    ...(filters.clientId ? { id: filters.clientId } : {}),
  };
  const where: Prisma.EpisodeWhereInput = {
    show: {
      client: clientWhere,
      ...(filters.showId ? { id: filters.showId } : {}),
    },
  };
  if (filters.status) where.status = filters.status;
  if (filters.search && filters.search.length > 0) {
    where.title = { contains: filters.search, mode: "insensitive" };
  }
  if (filters.bucket) applyBucketFilter(where, filters.bucket);
  // The `to` bound is end-of-day inclusive — the picker hands us a midnight
  // boundary and the natural "I want all episodes through Jun 24" semantics
  // means up to 23:59:59 on that day.
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: endOfDay(filters.to) } : {}),
    };
  }
  return where;
}

/**
 * Translate the virtual `bucket` filter into concrete Prisma `where`
 * fragments. Mutates `where` in place — mirrors how the other filters
 * are applied above.
 *
 * `review` becomes `outputs.some(pending)`. `drafts` becomes DRAFT-or-no-
 * outputs (`OR` clause). `done` is the negation of both — has outputs,
 * none pending. All three are expressible without introducing a raw SQL
 * escape hatch.
 */
function applyBucketFilter(where: Prisma.EpisodeWhereInput, bucket: EpisodeBucketFilter): void {
  const pendingOutput: Prisma.GeneratedOutputWhereInput = {
    supersededAt: null,
    status: { in: [...PENDING_REVIEW_STATUSES] },
  };
  switch (bucket) {
    case "review":
      where.outputs = { some: pendingOutput };
      break;
    case "drafts":
      // DRAFT status OR no non-superseded outputs. Both proxies for
      // "nothing to review yet" — the second one covers FAILED/legacy
      // rows where generation didn't produce anything.
      where.OR = [{ status: EpisodeStatus.DRAFT }, { outputs: { none: { supersededAt: null } } }];
      break;
    case "done":
      // Has at least one current output AND no pending output. Excludes
      // DRAFT/no-output rows and review rows both.
      where.AND = [
        { outputs: { some: { supersededAt: null } } },
        { outputs: { none: pendingOutput } },
      ];
      break;
  }
}

function endOfDay(d: Date): Date {
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return end;
}

export type EpisodeListRow = Episode & {
  show: {
    id: string;
    name: string;
    host: string;
    client: { id: string; name: string };
  };
  _count: { outputs: number };
  /**
   * How many current (non-superseded) outputs are sitting in a
   * reviewable state (READY / IN_REVIEW / AWAITING_CLIENT_APPROVAL).
   * Powers the list's Needs review / Done bucketing — `Episode.status`
   * alone would false-positive here since it never transitions past
   * READY as outputs advance.
   */
  pendingReviewCount: number;
};

/**
 * Paginated, filtered list for the `/episodes` index. Returns rows + the
 * total count so the UI can render "showing N of M" + prev/next controls.
 * Output count uses `supersededAt: null` to match what the grid shows.
 */
export async function listEpisodesFiltered(
  ctx: TenantContext,
  raw: ListEpisodesFilterInput,
): Promise<{ rows: EpisodeListRow[]; total: number }> {
  requireReadRole(ctx, READ_ROLES);
  const where = buildEpisodeListWhere(ctx, raw);

  const [dbRows, total] = await Promise.all([
    prisma.episode.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: raw.take,
      skip: raw.skip,
      include: {
        show: {
          select: {
            id: true,
            name: true,
            host: true,
            client: { select: { id: true, name: true } },
          },
        },
        _count: { select: { outputs: { where: { supersededAt: null } } } },
      },
    }),
    prisma.episode.count({ where }),
  ]);

  // Fetch pending-review counts for the page's episodes in a single
  // groupBy — one small query keyed by the ids we already have. Cheaper
  // than N+1 counts, and Prisma doesn't (yet) let us stack a second
  // `_count.outputs` clause with a different `where` alongside the
  // total-output count above.
  const pendingCountByEpisode = new Map<string, number>();
  if (dbRows.length > 0) {
    const groups = await prisma.generatedOutput.groupBy({
      by: ["episodeId"],
      where: {
        episodeId: { in: dbRows.map((r) => r.id) },
        supersededAt: null,
        status: { in: [...PENDING_REVIEW_STATUSES] },
      },
      _count: { _all: true },
    });
    for (const g of groups) pendingCountByEpisode.set(g.episodeId, g._count._all);
  }

  const rows: EpisodeListRow[] = dbRows.map((r) => ({
    ...r,
    pendingReviewCount: pendingCountByEpisode.get(r.id) ?? 0,
  }));

  return { rows, total };
}

/**
 * Cheap agency-wide bucket totals for the `/episodes` toolbar pills +
 * header subtitle. Independent of the paged list's search/show/date
 * filters — the pill counts are meant to convey attention magnitude at
 * a glance, so scoping them to the current filters would give shrinking
 * numbers as users narrow their view.
 *
 * `outputsWaitingReview` counts current outputs (non-superseded) sitting
 * in a reviewable status. Powers the "M outputs waiting for review"
 * fragment in the page subtitle.
 */
export async function episodeBucketTotals(
  ctx: TenantContext,
): Promise<{ all: number; draft: number; review: number; outputsWaitingReview: number }> {
  requireReadRole(ctx, READ_ROLES);

  // Group by status once — cheaper than N counts. Powers `all` + `draft`.
  const groups = await prisma.episode.groupBy({
    by: ["status"],
    where: { show: { client: { agencyId: ctx.agencyId } } },
    _count: { _all: true },
  });

  let all = 0;
  let draft = 0;
  for (const g of groups) {
    all += g._count._all;
    if (g.status === EpisodeStatus.DRAFT) draft += g._count._all;
  }

  // Episodes with at least one pending-review output. Can't be derived
  // from Episode.status because it stops at READY and never advances as
  // outputs get approved / scheduled / published. Use `distinct` on
  // episodeId over the pending-output set so an episode with three
  // pending outputs still counts once.
  const reviewGroups = await prisma.generatedOutput.groupBy({
    by: ["episodeId"],
    where: {
      supersededAt: null,
      status: { in: [...PENDING_REVIEW_STATUSES] },
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
    _count: { _all: true },
  });
  const review = reviewGroups.length;
  const outputsWaitingReview = reviewGroups.reduce((sum, g) => sum + g._count._all, 0);

  return { all, draft, review, outputsWaitingReview };
}

export async function getEpisode(ctx: TenantContext, episodeId: string): Promise<Episode> {
  requireReadRole(ctx, READ_ROLES);
  const episode = await prisma.episode.findFirst({
    where: {
      id: episodeId,
      show: { client: { agencyId: ctx.agencyId } },
    },
  });
  if (!episode) throw new NotFoundError(`Episode ${episodeId} not found`);
  return episode;
}

// ============================================================
// Mutations
// ============================================================

/**
 * Phase 2.7 — manual transcript correction. EDITOR+. Used when the
 * automatic Deepgram pass produced a poor transcript and the user wants
 * to paste their own, or to tweak it before generation runs.
 *
 * Tenant filter goes through the same nested join as createEpisode's
 * pre-check. A cross-tenant id surfaces as NotFoundError.
 */
export const updateEpisodeTranscriptInput = z.object({
  transcript: z.string().min(1, "Transcript can't be empty"),
});
export type UpdateEpisodeTranscriptInput = z.infer<typeof updateEpisodeTranscriptInput>;

/**
 * Episode-title rename — used by the inline-editable header on the
 * episode page so users can replace the wizard's "Untitled episode"
 * default. EDITOR+. Tenant-filtered atomically via `updateMany`.
 */
export const updateEpisodeTitleInput = z.object({
  title: z.string().trim().min(1, "Title can't be empty").max(240),
});
export type UpdateEpisodeTitleInput = z.infer<typeof updateEpisodeTitleInput>;

export async function updateEpisodeTitle(
  ctx: TenantContext,
  episodeId: string,
  patch: UpdateEpisodeTitleInput,
): Promise<Episode> {
  requireRole(ctx, WRITE_ROLES);
  const { count } = await prisma.episode.updateMany({
    where: {
      id: episodeId,
      show: { client: { agencyId: ctx.agencyId } },
    },
    data: { title: patch.title },
  });
  if (count === 0) throw new NotFoundError(`Episode ${episodeId} not found`);
  return prisma.episode.findUniqueOrThrow({ where: { id: episodeId } });
}

export async function updateEpisodeTranscript(
  ctx: TenantContext,
  episodeId: string,
  patch: UpdateEpisodeTranscriptInput,
): Promise<Episode> {
  requireRole(ctx, WRITE_ROLES);
  const { count } = await prisma.episode.updateMany({
    where: {
      id: episodeId,
      show: { client: { agencyId: ctx.agencyId } },
    },
    data: { transcript: patch.transcript },
  });
  if (count === 0) throw new NotFoundError(`Episode ${episodeId} not found`);
  return prisma.episode.findUniqueOrThrow({ where: { id: episodeId } });
}

/**
 * Phase 2.6 — batch generation. Given a list of episode ids, this:
 *   1. Filters to the ones that actually belong to the caller's agency
 *      (cross-tenant ids silently drop — the UI never lets them be
 *      selected, but a tampered request must not surface other tenants).
 *   2. Filters further to episodes whose status indicates a retry is
 *      meaningful (`DRAFT` or `FAILED`). READY / PROCESSING / ARCHIVED
 *      are skipped — the UI greys those out but we re-check server-side.
 *   3. For each remaining episode, derives the platform set from its
 *      current-version outputs (so a retry honours the original platform
 *      selection); falls back to the full 7-platform default when no
 *      outputs exist yet (typical for a brand-new FAILED row).
 *   4. Flips status → PROCESSING + clears any prior `failureReason` in
 *      one updateMany so the UI flips immediately and we don't dangle
 *      a stale FAILED banner.
 *
 * Returns the per-episode dispatch payload so the server action layer
 * can fan out the `episode/generate.requested` Inngest events. We
 * deliberately keep the Inngest dispatch in the action layer so this
 * repo helper stays purely DB-shaped and trivially testable.
 *
 * Plan capacity is checked upfront against the *count of episodes to
 * dispatch* — failing fast prevents a 50-episode batch from chewing
 * through the monthly cap with no warning.
 */
export const bulkGenerateInput = z.object({
  episodeIds: z.array(z.string().min(1)).min(1).max(50),
});
export type BulkGenerateInput = z.infer<typeof bulkGenerateInput>;

export type BulkGenerateDispatch = {
  episodeId: string;
  platforms: Platform[];
};

export type BulkGenerateResult = {
  dispatches: BulkGenerateDispatch[];
  /** Ids that resolved to the caller's tenant but were skipped because
   *  their status doesn't permit a regenerate. The UI surfaces this
   *  count so the user knows their click only partially landed. */
  skippedNotEligible: string[];
};

export async function bulkGenerateEpisodes(
  ctx: TenantContext,
  raw: BulkGenerateInput,
): Promise<BulkGenerateResult> {
  requireRole(ctx, WRITE_ROLES);
  const { episodeIds } = bulkGenerateInput.parse(raw);

  // Tenant-scoped lookup. `findMany` with `id in […]` + the agency join
  // filter is one round-trip and ignores any id that isn't ours.
  const rows = await prisma.episode.findMany({
    where: {
      id: { in: episodeIds },
      show: { client: { agencyId: ctx.agencyId } },
    },
    select: {
      id: true,
      status: true,
      outputs: {
        where: { supersededAt: null },
        select: { platform: true },
        distinct: ["platform"],
      },
    },
  });

  const eligible: typeof rows = [];
  const skippedNotEligible: string[] = [];
  for (const row of rows) {
    if (row.status === EpisodeStatus.DRAFT || row.status === EpisodeStatus.FAILED) {
      eligible.push(row);
    } else {
      skippedNotEligible.push(row.id);
    }
  }

  if (eligible.length === 0) {
    return { dispatches: [], skippedNotEligible };
  }

  // Batch generation unlocks at AGENCY — Solo and Studio operators still
  // fire episodes one at a time through the single-episode dispatch path.
  // Gate here (not just the UI) so a hand-crafted request still bounces.
  // Priority queue is a separate promise gated at NETWORK (see
  // `inngest/functions/generate-episode.ts`); AGENCY buyers get batch
  // dispatch but their events still land in the default queue.
  const plan = await getAgencyPlan(ctx.agencyId);
  assertMinPlan(plan, Plan.AGENCY);

  // Plan capacity for the count of NEW episode generations the batch
  // implies. Re-generating a FAILED row is still a generation in cost
  // terms (the prior attempt's UsageLogs were already billed), so we
  // count every eligible episode against the cap.
  await assertPlanCapacity(ctx.agencyId, plan, "episodes");

  await prisma.episode.updateMany({
    where: {
      id: { in: eligible.map((e) => e.id) },
      show: { client: { agencyId: ctx.agencyId } },
    },
    data: {
      status: EpisodeStatus.PROCESSING,
      failureReason: null,
    },
  });

  const dispatches: BulkGenerateDispatch[] = eligible.map((row) => {
    const platforms = row.outputs.length > 0 ? row.outputs.map((o) => o.platform) : ALL_PLATFORMS;
    return { episodeId: row.id, platforms };
  });

  return { dispatches, skippedNotEligible };
}

export async function createEpisode(
  ctx: TenantContext,
  input: CreateEpisodeInput,
): Promise<Episode> {
  requireRole(ctx, WRITE_ROLES);

  // Verify the target show belongs to the current agency (via its client)
  // before creating — otherwise a caller could attach an episode to another
  // tenant's show by sending its id.
  const show = await prisma.show.findFirst({
    where: {
      id: input.showId,
      client: { agencyId: ctx.agencyId },
    },
    select: { id: true },
  });
  if (!show) throw new NotFoundError(`Show ${input.showId} not found`);

  const plan = await getAgencyPlan(ctx.agencyId);
  await assertPlanCapacity(ctx.agencyId, plan, "episodes");

  return prisma.episode.create({
    data: {
      // Caller-supplied id is honoured when present (audio-upload flow);
      // omitting it lets Prisma's `@default(cuid())` fire as normal.
      ...(input.id ? { id: input.id } : {}),
      showId: input.showId,
      title: input.title,
      transcript: input.transcript,
      source: input.source,
      audioUrl: input.audioUrl ?? null,
      externalUrl: input.externalUrl ?? null,
      recordedAt: input.recordedAt ?? null,
      durationSec: input.durationSec ?? null,
    },
  });
}
