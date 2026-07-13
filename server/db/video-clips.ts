import "server-only";

import { ClipRenderStatus, type VideoClip } from "@prisma/client";
import { NotFoundError } from "@/server/auth/errors";
import { prisma } from "./client";

/**
 * CRUD for `VideoClip` rows.
 *
 * Convention departure: helpers take `agencyId: string` directly, not
 * `TenantContext`. Reasons: (a) writes are only called from Inngest
 * fns which have no user role, (b) reads are called from server
 * actions that resolve `TenantContext` themselves and pass its
 * `agencyId` — role gating for these reads adds nothing since a
 * REVIEWER seeing clips they can't approve is fine. If we later add
 * "hide unapproved clips from REVIEWERs" as a rule, add a
 * `TenantContext` overload — the current shape stays.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateClipDraft = {
  startMs: number;
  endMs: number;
  score: number;
  hookLine: string;
  sourceVideoUrl: string | null;
};

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Batch-create clip rows in PENDING for an episode. Verifies the episode
 * belongs to the given agency before creating anything (throws
 * NotFoundError if not, matching the tenant-isolation contract).
 */
export async function createClipsBatch(
  agencyId: string,
  episodeId: string,
  drafts: CreateClipDraft[],
): Promise<VideoClip[]> {
  const episode = await prisma.episode.findFirst({
    where: {
      id: episodeId,
      show: { client: { agencyId } },
    },
    select: { id: true },
  });
  if (!episode) throw new NotFoundError(`Episode ${episodeId} not found`);

  return prisma.$transaction(
    drafts.map((d) =>
      prisma.videoClip.create({
        data: {
          episodeId,
          agencyId,
          startMs: d.startMs,
          endMs: d.endMs,
          score: d.score,
          hookLine: d.hookLine,
          sourceVideoUrl: d.sourceVideoUrl,
          status: ClipRenderStatus.PENDING,
        },
      }),
    ),
  );
}

// ---------------------------------------------------------------------------
// State transitions (Inngest-side; no tenant guard needed — the fn has
// already verified the episode's agencyId before dispatching renders)
// ---------------------------------------------------------------------------

export async function markClipRendering(clipId: string): Promise<void> {
  await prisma.videoClip.update({
    where: { id: clipId },
    data: { status: ClipRenderStatus.RENDERING, renderError: null },
  });
}

export type MarkClipReadyInput = {
  renderedUrl: string;
  posterUrl: string;
};

export async function markClipReady(clipId: string, input: MarkClipReadyInput): Promise<void> {
  await prisma.videoClip.update({
    where: { id: clipId },
    data: {
      status: ClipRenderStatus.READY,
      renderedUrl: input.renderedUrl,
      // Worker returns "" when it couldn't extract a poster — normalise
      // to null so the UI's truthiness check falls through to the "Not
      // generated" placeholder instead of trying to render an empty src.
      posterUrl: input.posterUrl && input.posterUrl.trim() !== "" ? input.posterUrl : null,
      renderError: null,
    },
  });
}

export async function markClipFailed(clipId: string, reason: string): Promise<void> {
  await prisma.videoClip.update({
    where: { id: clipId },
    data: {
      status: ClipRenderStatus.FAILED,
      renderError: reason.slice(0, 500),
    },
  });
}

// ---------------------------------------------------------------------------
// Read (server-action / UI-facing)
// ---------------------------------------------------------------------------

export async function listClipsForEpisode(
  agencyId: string,
  episodeId: string,
): Promise<VideoClip[]> {
  return prisma.videoClip.findMany({
    where: { episodeId, agencyId },
    orderBy: [{ startMs: "asc" }],
  });
}

export async function countInFlightClips(agencyId: string): Promise<number> {
  return prisma.videoClip.count({
    where: {
      agencyId,
      status: { in: [ClipRenderStatus.PENDING, ClipRenderStatus.RENDERING] },
    },
  });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Delete every VideoClip on an episode. Used by `regenerateClipsAction` to
 * clear the slate before re-firing `episode/clips.requested`.
 *
 * Also deletes rows that are currently RENDERING — that's intentional. If
 * the render worker later returns for a deleted clip, the mark* helpers
 * will Prisma-error and the Inngest step returns; the leftover R2 objects
 * age out via the bucket's lifecycle policy.
 *
 * Filters by agencyId to keep tenant isolation intact even though we're
 * called by an action that has already gated on tenant.
 */
export async function deleteClipsForEpisode(
  agencyId: string,
  episodeId: string,
): Promise<{ count: number }> {
  return prisma.videoClip.deleteMany({
    where: { agencyId, episodeId },
  });
}

/** Single-clip delete. Used by the per-card "Delete" button. */
export async function deleteClipById(agencyId: string, clipId: string): Promise<{ count: number }> {
  return prisma.videoClip.deleteMany({
    where: { agencyId, id: clipId },
  });
}

// ---------------------------------------------------------------------------
// Retrim
// ---------------------------------------------------------------------------

/**
 * Tenant-scoped fetch of a single clip. Returns null when the clip doesn't
 * exist OR doesn't belong to the agency (same shape either way — tenant
 * isolation is enforced by returning null rather than throwing).
 */
export async function getClipById(agencyId: string, clipId: string): Promise<VideoClip | null> {
  return prisma.videoClip.findFirst({
    where: { id: clipId, agencyId },
  });
}

/**
 * Update just the bounds. Kept separate from `markClipRendering` so the
 * retrim flow can `updateClipBounds → markClipRendering` (two writes but
 * distinct semantics: bounds mutate, status transitions).
 */
export async function updateClipBounds(
  clipId: string,
  input: { startMs: number; endMs: number },
): Promise<void> {
  await prisma.videoClip.update({
    where: { id: clipId },
    data: { startMs: input.startMs, endMs: input.endMs },
  });
}
