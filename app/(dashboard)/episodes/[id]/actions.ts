"use server";

import { revalidatePath } from "next/cache";
import { Platform, TranscriptSource } from "@prisma/client";
import { z } from "zod";
import { requireAuthContext } from "@/server/auth/context";
import { NotFoundError, ValidationError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import { crossedVoiceRefreshThreshold } from "@/server/ai/voice-strength";
import { isLiveDb } from "@/server/data/source";
import { prisma } from "@/server/db/client";
import {
  updateEpisodeTitle,
  updateEpisodeTitleInput,
  updateEpisodeTranscript,
  updateEpisodeTranscriptInput,
} from "@/server/db/episodes";
import {
  approveOutput,
  listVersionsForOutput,
  markOutputRegenerating,
  regenerateOutputInput,
  rejectOutputForRevision,
  requestReviewOutput,
  reviewNoteInput,
  updateOutputContent,
  updateOutputContentInput,
} from "@/server/db/outputs";
import { inngest } from "@/inngest/client";

const idInput = z.object({ outputId: z.string().min(1) });

export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

function noopOk<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

// ============================================================
// Edit (inline content save)
// ============================================================

const editInput = idInput.and(updateOutputContentInput);

export async function updateOutputContentAction(
  raw: unknown,
): Promise<ActionResult<{ outputId: string; delta: number; totalEditDistance: number }>> {
  const parsed = editInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid edit input", parsed.error.issues);
  }
  const { outputId } = parsed.data;

  if (!isLiveDb()) {
    // Sample-data mode: nothing persists; the UI already updated locally.
    return noopOk({ outputId, delta: 0, totalEditDistance: 0 });
  }

  const auth = await requireAuthContext();
  const { output, delta } = await updateOutputContent(
    toTenantContext(auth),
    outputId,
    parsed.data.content,
  );
  revalidatePath(`/episodes/${auth.agency.id}`);
  return noopOk({
    outputId,
    delta,
    totalEditDistance: output.editDistance,
  });
}

// ============================================================
// Approve (writes a VoiceSample transactionally)
// ============================================================

export async function approveOutputAction(
  raw: unknown,
): Promise<ActionResult<{ outputId: string; editDistance: number }>> {
  const parsed = idInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid approve input", parsed.error.issues);
  }
  const { outputId } = parsed.data;

  if (!isLiveDb()) {
    return noopOk({ outputId, editDistance: 0 });
  }

  const auth = await requireAuthContext();
  const tenant = toTenantContext(auth);

  // We need the showId to (a) count samples before approval so we can
  // detect a voice-refresh threshold crossing, and (b) include it in the
  // refresh event. Pull editDistance too so the client can fire a precise
  // analytics event after approval without a second round-trip.
  const output = await prisma.generatedOutput.findFirst({
    where: {
      id: outputId,
      episode: { show: { client: { agencyId: auth.agency.id } } },
    },
    select: {
      editDistance: true,
      episode: { select: { showId: true } },
    },
  });
  const showId = output?.episode.showId ?? null;
  const editDistance = output?.editDistance ?? 0;
  const previousSampleCount = showId ? await prisma.voiceSample.count({ where: { showId } }) : 0;

  await approveOutput(tenant, outputId, auth.member.id);

  // Voice-description refresh: approve always adds exactly one VoiceSample,
  // so previous + 1 is the post-approve count. Fire-and-forget; failure to
  // enqueue must not roll back the approve.
  if (showId) {
    const newSampleCount = previousSampleCount + 1;
    if (crossedVoiceRefreshThreshold(previousSampleCount, newSampleCount)) {
      try {
        await inngest.send({
          name: "voice/refresh.requested",
          data: { showId },
        });
      } catch (err) {
        console.error("voice/refresh.requested dispatch failed", err);
      }
    }
  }

  // The output's parent episode page (and the topbar voice-strength badge)
  // needs to refetch after approval — revalidate everything under the route.
  revalidatePath("/episodes", "layout");
  revalidatePath("/voice", "layout");
  revalidatePath("/clients", "layout");
  return noopOk({ outputId, editDistance });
}

// ============================================================
// Regenerate (single output)
// ============================================================

const regenInput = idInput.and(regenerateOutputInput);

export async function regenerateOutputAction(
  raw: unknown,
): Promise<ActionResult<{ outputId: string }>> {
  const parsed = regenInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid regen input", parsed.error.issues);
  }
  const { outputId, instruction } = parsed.data;

  if (!isLiveDb()) {
    return noopOk({ outputId });
  }

  const auth = await requireAuthContext();
  // Versioning: this creates a NEW GeneratedOutput row (version+1) and stamps
  // the prior row as superseded. The Inngest function must target the new id.
  const newOutput = await markOutputRegenerating(
    toTenantContext(auth),
    outputId,
    instruction,
    auth.member.id,
  );

  await inngest.send({
    name: "episode/regenerate.output.requested",
    data: { outputId: newOutput.id, instruction },
  });

  revalidatePath(`/episodes/${auth.agency.id}`);
  return noopOk({ outputId: newOutput.id });
}

// ============================================================
// Request review (READY → IN_REVIEW)
// ============================================================

const requestReviewInput = idInput.and(reviewNoteInput);

export async function requestReviewOutputAction(
  raw: unknown,
): Promise<ActionResult<{ outputId: string }>> {
  const parsed = requestReviewInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid request-review input", parsed.error.issues);
  }
  const { outputId, note } = parsed.data;

  if (!isLiveDb()) return noopOk({ outputId });

  const auth = await requireAuthContext();
  await requestReviewOutput(toTenantContext(auth), outputId, auth.member.id, note);
  revalidatePath(`/episodes/${auth.agency.id}`);
  return noopOk({ outputId });
}

// ============================================================
// Reject (IN_REVIEW → READY)
// ============================================================

const rejectInput = idInput.and(reviewNoteInput);

export async function rejectOutputAction(
  raw: unknown,
): Promise<ActionResult<{ outputId: string }>> {
  const parsed = rejectInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid reject input", parsed.error.issues);
  }
  const { outputId, note } = parsed.data;

  if (!isLiveDb()) return noopOk({ outputId });

  const auth = await requireAuthContext();
  await rejectOutputForRevision(toTenantContext(auth), outputId, auth.member.id, note);
  revalidatePath(`/episodes/${auth.agency.id}`);
  return noopOk({ outputId });
}

// ============================================================
// Version history (used by the in-card switcher)
// ============================================================

export type OutputVersionSummary = {
  id: string;
  version: number;
  status: string;
  content: string;
  lastInstruction: string | null;
  createdAt: string;
  isCurrent: boolean;
};

export async function listOutputVersionsAction(
  raw: unknown,
): Promise<ActionResult<{ versions: OutputVersionSummary[] }>> {
  const parsed = idInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid version-history input", parsed.error.issues);
  }
  const { outputId } = parsed.data;

  if (!isLiveDb()) {
    return noopOk({ versions: [] });
  }

  const auth = await requireAuthContext();
  const rows = await listVersionsForOutput(toTenantContext(auth), outputId);
  const versions: OutputVersionSummary[] = rows.map((r) => ({
    id: r.id,
    version: r.version,
    status: r.status,
    content: r.content,
    lastInstruction: r.lastInstruction,
    createdAt: r.createdAt.toISOString(),
    isCurrent: r.supersededAt === null,
  }));
  return noopOk({ versions });
}

// ============================================================
// Phase 2.7 — transcribe controls
// ============================================================

const PLATFORM_VALUES = Object.values(Platform) as [Platform, ...Platform[]];

const retranscribeInput = z.object({
  episodeId: z.string().min(1),
  /**
   * Platforms to generate once the transcript lands. Defaults to the
   * full set so the retry CTA "just works" — the user originally chose
   * platforms on the wizard, but we don't carry that selection through
   * to the episode page.
   */
  platforms: z.array(z.enum(PLATFORM_VALUES)).default(PLATFORM_VALUES),
});

/**
 * Re-fire `episode/transcribe.requested` for an UPLOAD episode that
 * either failed transcription or didn't kick off cleanly. EDITOR+ only.
 *
 * Tenant gate: we look up the episode through the agency join. A wrong
 * id surfaces as a generic "not found" instead of leaking ownership.
 */
export async function retranscribeEpisodeAction(
  raw: unknown,
): Promise<ActionResult<{ episodeId: string }>> {
  const parsed = retranscribeInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid retranscribe input", parsed.error.issues);
  }
  const { episodeId, platforms } = parsed.data;

  if (!isLiveDb()) return noopOk({ episodeId });

  const auth = await requireAuthContext();
  const episode = await prisma.episode.findFirst({
    where: {
      id: episodeId,
      show: { client: { agencyId: auth.agency.id } },
    },
    select: { id: true, source: true, audioUrl: true },
  });
  if (!episode) throw new NotFoundError(`Episode ${episodeId} not found`);
  if (episode.source !== TranscriptSource.UPLOAD) {
    return { ok: false, error: "Only UPLOAD episodes can be re-transcribed." };
  }
  if (!episode.audioUrl) {
    return { ok: false, error: "No audio file on file — upload one before retrying." };
  }

  await inngest.send({
    name: "episode/transcribe.requested",
    data: { episodeId, platforms },
  });

  revalidatePath(`/episodes/${episodeId}`);
  return noopOk({ episodeId });
}

const manualTranscriptInput = z
  .object({ episodeId: z.string().min(1) })
  .and(updateEpisodeTranscriptInput)
  .and(z.object({ platforms: z.array(z.enum(PLATFORM_VALUES)).default(PLATFORM_VALUES) }));

/**
 * Manual transcript correction — pastes or hand-edits the transcript
 * straight onto the Episode and kicks the generation pipeline. Used
 * when Deepgram returned garbage or the user has their own transcript.
 */
export async function updateEpisodeTranscriptAction(
  raw: unknown,
): Promise<ActionResult<{ episodeId: string; chars: number }>> {
  const parsed = manualTranscriptInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid transcript input", parsed.error.issues);
  }
  const { episodeId, transcript, platforms } = parsed.data;

  if (!isLiveDb()) return noopOk({ episodeId, chars: transcript.length });

  const auth = await requireAuthContext();
  const tenant = toTenantContext(auth);

  // Snapshot whether this episode was awaiting a transcript before the
  // write — if so, we still need to kick generation. If it already had
  // outputs, the user is just correcting in-place and we skip the kick
  // to avoid duplicating generation runs.
  const prior = await prisma.episode.findFirst({
    where: { id: episodeId, show: { client: { agencyId: auth.agency.id } } },
    select: { transcript: true },
  });
  if (!prior) throw new NotFoundError(`Episode ${episodeId} not found`);
  const wasAwaiting = prior.transcript.trim().length === 0;

  await updateEpisodeTranscript(tenant, episodeId, { transcript });

  if (wasAwaiting) {
    await inngest.send({
      name: "episode/generate.requested",
      data: { episodeId, platforms },
    });
  }

  revalidatePath(`/episodes/${episodeId}`);
  return noopOk({ episodeId, chars: transcript.length });
}

const renameInput = z.object({ episodeId: z.string().min(1) }).and(updateEpisodeTitleInput);

/**
 * Inline rename from the episode page header. EDITOR+. Revalidates the
 * episode route + the /episodes index so the list reflects the new
 * title immediately.
 */
export async function updateEpisodeTitleAction(
  raw: unknown,
): Promise<ActionResult<{ episodeId: string; title: string }>> {
  const parsed = renameInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid title", parsed.error.issues);
  }
  const { episodeId, title } = parsed.data;

  if (!isLiveDb()) return noopOk({ episodeId, title });

  const auth = await requireAuthContext();
  const updated = await updateEpisodeTitle(toTenantContext(auth), episodeId, { title });

  revalidatePath(`/episodes/${episodeId}`);
  revalidatePath("/episodes");
  return noopOk({ episodeId, title: updated.title });
}
