import "server-only";

import { ClipRenderStatus } from "@prisma/client";
import { prisma } from "./client";

/**
 * Q1 feature #5 — CRUD for the audiogram fields on GeneratedOutput.
 *
 * Audiogram state lives on GeneratedOutput as parallel nullable columns
 * (audiogramStatus / audiogramUrl / audiogramPosterUrl / audiogramError /
 * audiogramStartMs / audiogramEndMs / audiogramAspect) rather than a new
 * table — audiograms are 1:1 with their parent output, so a separate row
 * would just add a JOIN for zero gain.
 *
 * All writers filter by { agencyId } implicitly via the output's chain
 * because callers are trusted (Inngest fns that have already verified
 * the tenant). Explicit tenant guard lives on the read + delete paths.
 */

export type AudiogramInitInput = {
  startMs: number;
  endMs: number;
  aspect: "1:1" | "9:16";
};

/**
 * Initialise the audiogram fields on an output. Sets status = PENDING,
 * clears any prior URLs/errors, records the requested bounds + aspect.
 * Called by `requestAudiogramAction` right before firing the event so
 * the UI immediately reflects "queued" state on the next poll.
 */
export async function initAudiogram(outputId: string, input: AudiogramInitInput): Promise<void> {
  await prisma.generatedOutput.update({
    where: { id: outputId },
    data: {
      audiogramStatus: ClipRenderStatus.PENDING,
      audiogramUrl: null,
      audiogramPosterUrl: null,
      audiogramError: null,
      audiogramStartMs: input.startMs,
      audiogramEndMs: input.endMs,
      audiogramAspect: input.aspect,
    },
  });
}

export async function markAudiogramRendering(outputId: string): Promise<void> {
  await prisma.generatedOutput.update({
    where: { id: outputId },
    data: { audiogramStatus: ClipRenderStatus.RENDERING, audiogramError: null },
  });
}

export async function markAudiogramReady(
  outputId: string,
  input: { renderedUrl: string; posterUrl: string },
): Promise<void> {
  await prisma.generatedOutput.update({
    where: { id: outputId },
    data: {
      audiogramStatus: ClipRenderStatus.READY,
      audiogramUrl: input.renderedUrl,
      audiogramPosterUrl: input.posterUrl,
      audiogramError: null,
    },
  });
}

export async function markAudiogramFailed(outputId: string, reason: string): Promise<void> {
  await prisma.generatedOutput.update({
    where: { id: outputId },
    data: {
      audiogramStatus: ClipRenderStatus.FAILED,
      audiogramError: reason.slice(0, 500),
    },
  });
}

/**
 * Tenant-scoped fetch of just the audiogram-relevant columns of an output.
 * Returns null when the output doesn't exist or doesn't belong to the
 * agency.
 */
export async function getOutputAudiogramContext(
  agencyId: string,
  outputId: string,
): Promise<{
  id: string;
  agencyId: string;
  episodeId: string;
  audioUrl: string | null;
  transcriptWords: unknown;
  showArtworkUrl: string | null;
} | null> {
  const row = await prisma.generatedOutput.findFirst({
    where: {
      id: outputId,
      episode: { show: { client: { agencyId } } },
    },
    select: {
      id: true,
      episodeId: true,
      episode: {
        select: {
          audioUrl: true,
          transcriptWords: true,
          show: {
            select: {
              artworkUrl: true,
              client: { select: { agencyId: true } },
            },
          },
        },
      },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    agencyId: row.episode.show.client.agencyId,
    episodeId: row.episodeId,
    audioUrl: row.episode.audioUrl,
    transcriptWords: row.episode.transcriptWords,
    showArtworkUrl: row.episode.show.artworkUrl,
  };
}
