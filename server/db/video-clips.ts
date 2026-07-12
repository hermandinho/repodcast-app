import "server-only";

import { ClipRenderStatus, type VideoClip } from "@prisma/client";
import { NotFoundError } from "@/server/auth/errors";
import { prisma } from "./client";

/**
 * Q1 wk4 — CRUD for `VideoClip` rows.
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
      posterUrl: input.posterUrl,
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
