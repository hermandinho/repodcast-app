"use server";

import { revalidatePath } from "next/cache";
import { EpisodePipelineStage, EpisodeStatus, Platform, TranscriptSource } from "@prisma/client";
import { z } from "zod";
import { requireAuthContext } from "@/server/auth/context";
import { NotFoundError, ValidationError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import {
  VOICE_DRIFT_WINDOW_SIZE,
  computeRecentDriftRatio,
  shouldRefreshVoiceDescription,
} from "@/server/ai/voice-strength";
import { isLiveDb } from "@/server/data/source";
import { prisma } from "@/server/db/client";
import {
  updateEpisodeTitle,
  updateEpisodeTitleInput,
  updateEpisodeTranscript,
  updateEpisodeTranscriptInput,
} from "@/server/db/episodes";
import { markPortalFeedbackReadForOutput } from "@/server/db/client-portal";
import {
  approveOutput,
  listVersionsForOutput,
  markOutputRegenerating,
  recallOutputFromClient,
  regenerateOutputInput,
  rejectOutputForRevision,
  requestReviewOutput,
  reviewNoteInput,
  updateOutputContent,
  updateOutputContentInput,
} from "@/server/db/outputs";
import { deleteClipById, deleteClipsForEpisode, getClipById } from "@/server/db/video-clips";
import { assertAndConsumeRegen } from "@/server/billing/limits";
import { planLimitsFor } from "@/lib/plans";
import { resolveClipSource } from "@/server/media/clip-source";
import {
  ALLOWED_AUDIO_CONTENT_TYPES,
  MAX_AUDIO_UPLOAD_BYTES,
  audioExtensionFor,
  isAllowedAudioContentType,
  isVideoContentType,
} from "@/lib/audio";
import { getR2Client, signR2UploadUrl } from "@/server/storage/r2";
import { randomUUID } from "node:crypto";
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
  const tenant = toTenantContext(auth);
  const { output, delta } = await updateOutputContent(tenant, outputId, parsed.data.content);
  // Editing an output implies the agency saw the client's request and is
  // addressing it — clear the unread badge for any feedback that targets
  // this row. Best-effort: a no-op when there's nothing unread, and
  // never rethrown (the edit already succeeded and shouldn't roll back).
  let markedFeedback = 0;
  try {
    markedFeedback = await markPortalFeedbackReadForOutput(tenant, outputId, auth.member.id);
  } catch (err) {
    console.error("markPortalFeedbackReadForOutput failed (edit)", err);
  }
  revalidatePath(`/episodes/${auth.agency.id}`);
  // Sidebar's `countUnreadPortalFeedbackForAgency` lives in the root
  // layout — invalidate it so the badge count reflects reality on the
  // next render. Skip when nothing changed to avoid needless churn.
  if (markedFeedback > 0) revalidatePath("/", "layout");
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
): Promise<ActionResult<{ outputId: string; editDistance: number; showId: string | null }>> {
  const parsed = idInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid approve input", parsed.error.issues);
  }
  const { outputId } = parsed.data;

  if (!isLiveDb()) {
    return noopOk({ outputId, editDistance: 0, showId: null });
  }

  const auth = await requireAuthContext();
  const tenant = toTenantContext(auth);

  // We need the showId to (a) count samples before approval so we can
  // decide whether to fire a refresh, and (b) include it in the refresh
  // event. Pull the parent client's validationMode too — in CLIENT mode
  // `approveOutput` sends the output to the portal (no VoiceSample
  // written yet), so the refresh event must NOT fire; it only fires when
  // INTERNAL mode's approve actually wrote a sample. Pull editDistance so
  // the client can fire a precise analytics event without a second RTT.
  const output = await prisma.generatedOutput.findFirst({
    where: {
      id: outputId,
      episode: { show: { client: { agencyId: auth.agency.id } } },
    },
    select: {
      editDistance: true,
      episode: {
        select: {
          showId: true,
          show: {
            select: {
              voiceDescriptionSampleCount: true,
              client: { select: { validationMode: true } },
            },
          },
        },
      },
    },
  });
  const showId = output?.episode.showId ?? null;
  const validationMode = output?.episode.show.client.validationMode ?? "INTERNAL";
  const editDistance = output?.editDistance ?? 0;
  const sampleCountAtLastRefresh = output?.episode.show.voiceDescriptionSampleCount ?? 0;
  const previousSampleCount = showId ? await prisma.voiceSample.count({ where: { showId } }) : 0;

  await approveOutput(tenant, outputId, auth.member.id);

  // Voice-description refresh: only INTERNAL-mode approvals write a sample
  // synchronously — CLIENT mode hands off to the portal, and the sample
  // lands later via `clientApproveOutputFromPortal`. Firing the refresh
  // for the CLIENT branch would query an empty VoiceSample table and
  // trip `refresh-voice-description`'s "No approved samples" guard on
  // the first approval, burning an Inngest run every time. The portal
  // approve path should dispatch its own refresh once the client
  // confirms — tracked separately.
  // Fire-and-forget: an inngest.send failure must not roll back approve.
  //
  // Recount post-approve rather than assuming `+1`: the quality gate in
  // `voice-samples.writeSampleFromOutput` skips writes for outputs below
  // the training floor, so approve doesn't always yield a sample. A live
  // recount also prevents us from mis-firing the refresh at a threshold
  // the sample pool never actually crossed.
  if (showId && validationMode === "INTERNAL") {
    const newSampleCount = await prisma.voiceSample.count({ where: { showId } });

    // Pull the recent-window samples with their linked output's edit
    // distance so `shouldRefreshVoiceDescription` can decide on drift
    // (mean edit ratio) alongside the milestone + periodic triggers.
    // Only bother querying when there's a realistic chance of firing —
    // pre-first-threshold this is dead weight.
    let recentDriftRatio: number | undefined;
    if (newSampleCount > 0) {
      const recent = await prisma.voiceSample.findMany({
        where: { showId },
        orderBy: { createdAt: "desc" },
        take: VOICE_DRIFT_WINDOW_SIZE,
        select: {
          content: true,
          generatedOutput: { select: { editDistance: true } },
        },
      });
      recentDriftRatio = computeRecentDriftRatio(
        recent.map((s) => ({
          content: s.content,
          editDistance: s.generatedOutput?.editDistance,
        })),
      );
    }

    if (
      shouldRefreshVoiceDescription({
        previousSampleCount,
        newSampleCount,
        sampleCountAtLastRefresh,
        recentDriftRatio,
      })
    ) {
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
  return noopOk({ outputId, editDistance, showId });
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
  const tenant = toTenantContext(auth);
  // Versioning: this creates a NEW GeneratedOutput row (version+1) and stamps
  // the prior row as superseded. The Inngest function must target the new id.
  const newOutput = await markOutputRegenerating(tenant, outputId, instruction, auth.member.id);
  // The client's feedback is attached to the pre-supersede row (`outputId`,
  // not `newOutput.id`), so clear it here — the agency is regenerating in
  // direct response to the request. Best-effort; never rethrown.
  let markedFeedback = 0;
  try {
    markedFeedback = await markPortalFeedbackReadForOutput(tenant, outputId, auth.member.id);
  } catch (err) {
    console.error("markPortalFeedbackReadForOutput failed (regen)", err);
  }

  // Phase 3.5 — tag with plan + agencyId so `regenerate-output`'s
  // priority.run bumps NETWORK ahead and the per-agency concurrency key
  // keeps one agency's retry storm from starving other agencies. Reads
  // plan straight off auth — same QoS-vs-enforcement tradeoff as the
  // other Phase 3.5 dispatchers.
  await inngest.send({
    name: "episode/regenerate.output.requested",
    data: {
      outputId: newOutput.id,
      instruction,
      plan: auth.agency.plan,
      agencyId: auth.agency.id,
    },
  });

  revalidatePath(`/episodes/${auth.agency.id}`);
  // Sidebar badge revalidation — same rationale as the edit action's
  // gated invalidation above.
  if (markedFeedback > 0) revalidatePath("/", "layout");
  return noopOk({ outputId: newOutput.id });
}

// ============================================================
// Auto-mark portal feedback read on drawer open
// ============================================================

/**
 * Fired from the OutputDrawer on mount. Marks every unread
 * `ClientPortalFeedback` row targeting this output as read so the
 * sidebar badge decrements the moment the operator has actually seen
 * the drafts the client asked to revise. The edit and regenerate
 * actions carry the same auto-mark; this action covers the "opened
 * the drawer but didn't change anything yet" path.
 *
 * Best-effort, no revalidation of the current page — the drawer is
 * already open with the correct output data, and re-rendering it mid-
 * mount would flicker. We do revalidate the root layout so the sidebar
 * badge count refreshes on the next server round-trip.
 */
export async function markOutputFeedbackReadAction(
  raw: unknown,
): Promise<ActionResult<{ outputId: string; marked: number }>> {
  const parsed = idInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid mark-feedback-read input", parsed.error.issues);
  }
  const { outputId } = parsed.data;

  if (!isLiveDb()) return noopOk({ outputId, marked: 0 });

  const auth = await requireAuthContext();
  let marked = 0;
  try {
    marked = await markPortalFeedbackReadForOutput(toTenantContext(auth), outputId, auth.member.id);
  } catch (err) {
    console.error("markPortalFeedbackReadForOutput failed (drawer open)", err);
    return noopOk({ outputId, marked: 0 });
  }
  // Sidebar badge lives in the shared dashboard layout — invalidate the
  // root so its `countUnreadPortalFeedbackForAgency` re-runs on the next
  // render. Skip when nothing was actually marked so we don't churn.
  if (marked > 0) {
    revalidatePath("/", "layout");
  }
  return noopOk({ outputId, marked });
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
// Recall from client (AWAITING_CLIENT_APPROVAL → READY)
// ============================================================
//
// Mirror of the portal-side revision request, initiated by the agency
// instead of the end client. Used when an operator spots something to
// fix after the output was already sent to the portal but before the
// client acted on it. Post-recall the output lands in READY, editable +
// regenerable via the standard drafts flow — the operator adjusts, then
// re-approves (which re-sends to the portal in CLIENT mode).

const recallInput = idInput.and(reviewNoteInput);

export async function recallOutputAction(
  raw: unknown,
): Promise<ActionResult<{ outputId: string }>> {
  const parsed = recallInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid recall input", parsed.error.issues);
  }
  const { outputId, note } = parsed.data;

  if (!isLiveDb()) return noopOk({ outputId });

  const auth = await requireAuthContext();
  await recallOutputFromClient(toTenantContext(auth), outputId, auth.member.id, note);
  revalidatePath(`/episodes/${auth.agency.id}`);
  return noopOk({ outputId });
}

// ============================================================
// Version history (used by the in-card switcher)
// ============================================================

// Canonical definition lives in `./types` so client components can
// import it without dragging this `"use server"` module through their
// bundle's type-resolution graph. Re-exported here for existing server
// callers that already reach for the actions module.
export type { OutputVersionSummary } from "./types";
import type { OutputVersionSummary } from "./types";

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
    quality: r.quality,
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
    // Nudge the pipeline stage → GENERATING so the SSE stream drops the
    // <TranscribingPanel> immediately; the generate-episode function's
    // own `mark-processing` step will overwrite this once it starts.
    await prisma.episode.update({
      where: { id: episodeId },
      data: {
        status: EpisodeStatus.PROCESSING,
        stage: EpisodePipelineStage.GENERATING,
      },
    });
    await inngest.send({
      name: "episode/generate.requested",
      data: {
        episodeId,
        platforms,
        plan: auth.agency.plan,
        agencyId: auth.agency.id,
      },
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

// ============================================================
// Q1 wk4 — Request clip generation (episode → highlights → clip rows → renders)
// ============================================================

const requestClipsInput = z.object({
  episodeId: z.string().min(1),
  maxClips: z.number().int().min(1).max(10).optional(),
});

export async function requestClipsAction(
  raw: unknown,
): Promise<ActionResult<{ episodeId: string }>> {
  const parsed = requestClipsInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid clip-request input", parsed.error.issues);
  }
  const { episodeId, maxClips } = parsed.data;

  if (!isLiveDb()) return noopOk({ episodeId });

  const auth = await requireAuthContext();
  // Read-side check: episode must belong to this agency AND have a
  // resolvable source AND transcriptWords. The Inngest fn re-verifies
  // everything, but failing fast here gives the user an actionable
  // error before we spend an event.
  const episode = await prisma.episode.findFirst({
    where: {
      id: episodeId,
      show: { client: { agencyId: auth.agency.id } },
    },
    select: {
      id: true,
      source: true,
      sourceVideoUrl: true,
      audioUrl: true,
      transcriptWords: true,
    },
  });
  if (!episode) throw new NotFoundError(`Episode ${episodeId} not found`);
  if (!resolveClipSource(episode)) {
    return {
      ok: false,
      error:
        "This episode has no source file. Clip generation needs an uploaded video/audio file or a YouTube import.",
    };
  }
  if (!episode.transcriptWords) {
    return {
      ok: false,
      error:
        "This episode was transcribed before the clip pipeline shipped. Re-transcribe to enable clips.",
    };
  }

  // PricingV2 — cap `maxClips` at the plan's clipsPerEpisode. Passed
  // downstream into `selectHighlights({ maxClips })`.
  const planLimits = planLimitsFor(auth.agency.plan);
  const cappedMax = Math.min(maxClips ?? planLimits.clipsPerEpisode, planLimits.clipsPerEpisode);

  await inngest.send({
    name: "episode/clips.requested",
    data: { episodeId, agencyId: auth.agency.id, maxClips: cappedMax },
  });

  revalidatePath(`/episodes/${episodeId}/clips`);
  return noopOk({ episodeId });
}

// ============================================================
// Q1 wk5 — Regenerate all clips (wipe + re-request)
// ============================================================

const regenerateClipsInput = z.object({
  episodeId: z.string().min(1),
  maxClips: z.number().int().min(1).max(10).optional(),
});

export async function regenerateClipsAction(
  raw: unknown,
): Promise<ActionResult<{ episodeId: string; deleted: number }>> {
  const parsed = regenerateClipsInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid regenerate-clips input", parsed.error.issues);
  }
  const { episodeId, maxClips } = parsed.data;

  if (!isLiveDb()) return noopOk({ episodeId, deleted: 0 });

  const auth = await requireAuthContext();
  const episode = await prisma.episode.findFirst({
    where: { id: episodeId, show: { client: { agencyId: auth.agency.id } } },
    select: {
      id: true,
      source: true,
      sourceVideoUrl: true,
      audioUrl: true,
      transcriptWords: true,
    },
  });
  if (!episode) throw new NotFoundError(`Episode ${episodeId} not found`);
  if (!resolveClipSource(episode)) {
    return { ok: false, error: "This episode has no source file." };
  }
  if (!episode.transcriptWords) {
    return {
      ok: false,
      error: "This episode has no transcript-word timings. Re-transcribe to enable clips.",
    };
  }

  // PricingV2 §3 — regenerate-all counts as a clip regeneration. Consume
  // before firing so the counter is authoritative even if the caller's
  // event dispatch fails downstream. ForbiddenError from
  // assertAndConsumeRegen bubbles up to the client as a 403 → the
  // caller renders the friendly upgrade prompt.
  try {
    await assertAndConsumeRegen(auth.agency.id, auth.agency.plan, "clip");
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const { count: deleted } = await deleteClipsForEpisode(auth.agency.id, episodeId);
  await inngest.send({
    name: "episode/clips.requested",
    data: { episodeId, agencyId: auth.agency.id, maxClips },
  });

  revalidatePath(`/episodes/${episodeId}/clips`);
  return noopOk({ episodeId, deleted });
}

// ============================================================
// Q1 wk5 — Delete a single clip
// ============================================================

const deleteClipInput = z.object({
  clipId: z.string().min(1),
  episodeId: z.string().min(1),
});

export async function deleteClipAction(
  raw: unknown,
): Promise<ActionResult<{ clipId: string; deleted: number }>> {
  const parsed = deleteClipInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid delete-clip input", parsed.error.issues);
  }
  const { clipId, episodeId } = parsed.data;

  if (!isLiveDb()) return noopOk({ clipId, deleted: 0 });

  const auth = await requireAuthContext();
  const { count } = await deleteClipById(auth.agency.id, clipId);
  revalidatePath(`/episodes/${episodeId}/clips`);
  return noopOk({ clipId, deleted: count });
}

// ============================================================
// Q1 wk10 — Attach a source video to an existing episode
//
// Two-step direct-to-R2 flow (mirrors the audio-upload wizard). Step
// 1 signs a PUT URL; the browser uploads; step 2 stamps the resulting
// R2 key onto Episode.sourceVideoUrl so the clip pipeline picks it
// up. Bypasses the audio-transcribe path — transcript already exists,
// we're just providing an alternate video source for rendering.
// ============================================================

const signSourceVideoUploadInput = z.object({
  episodeId: z.string().min(1),
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1),
  size: z.number().int().nonnegative(),
});

export async function signSourceVideoUploadAction(
  raw: unknown,
): Promise<ActionResult<{ uploadUrl: string; objectKey: string }>> {
  const parsed = signSourceVideoUploadInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid upload request", parsed.error.issues);
  }
  const { episodeId, filename, contentType, size } = parsed.data;

  if (!isAllowedAudioContentType(contentType) || !isVideoContentType(contentType)) {
    return {
      ok: false,
      error: `Unsupported video format ${contentType}. Allowed: MP4, MOV, WebM, MKV.`,
    };
  }
  if (size > MAX_AUDIO_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `File is ${Math.round(size / (1024 * 1024))} MB — limit is ${Math.round(MAX_AUDIO_UPLOAD_BYTES / (1024 * 1024))} MB.`,
    };
  }

  const auth = await requireAuthContext();
  // Tenant guard on the episode.
  const episode = await prisma.episode.findFirst({
    where: { id: episodeId, show: { client: { agencyId: auth.agency.id } } },
    select: { id: true },
  });
  if (!episode) throw new NotFoundError(`Episode ${episodeId} not found`);

  if (!getR2Client()) {
    return {
      ok: false,
      error: "R2 is not configured. Contact support.",
    };
  }

  // Unique per-upload key so re-uploads don't overwrite prior versions
  // (Prisma has no cascade delete on Episode.sourceVideoUrl updates, so
  // old objects age out via bucket lifecycle policy).
  const uploadId = randomUUID();
  const ext = audioExtensionFor(contentType, filename);
  const objectKey = `sources/${auth.agency.id}/${episodeId}/${uploadId}.${ext}`;

  // 15 min — video files are bigger than audio; the presign needs to
  // outlast a slow home connection PUT.
  const uploadUrl = await signR2UploadUrl(objectKey, contentType, 15 * 60);

  return { ok: true, data: { uploadUrl, objectKey } };
}

const finalizeSourceVideoInput = z.object({
  episodeId: z.string().min(1),
  objectKey: z.string().min(1),
});

export async function finalizeSourceVideoUploadAction(
  raw: unknown,
): Promise<ActionResult<{ episodeId: string }>> {
  const parsed = finalizeSourceVideoInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid finalize input", parsed.error.issues);
  }
  const { episodeId, objectKey } = parsed.data;

  if (!isLiveDb()) return noopOk({ episodeId });

  const auth = await requireAuthContext();
  // Verify the key we're about to persist is one we ourselves signed —
  // the prefix embeds the agency id and episode id, so a tampered
  // request can't point us at another agency's assets.
  const expectedPrefix = `sources/${auth.agency.id}/${episodeId}/`;
  if (!objectKey.startsWith(expectedPrefix)) {
    return { ok: false, error: "Upload key does not match this episode." };
  }

  const episode = await prisma.episode.findFirst({
    where: { id: episodeId, show: { client: { agencyId: auth.agency.id } } },
    select: { id: true },
  });
  if (!episode) throw new NotFoundError(`Episode ${episodeId} not found`);

  await prisma.episode.update({
    where: { id: episodeId },
    data: { sourceVideoUrl: objectKey },
  });

  revalidatePath(`/episodes/${episodeId}/clips`);
  return noopOk({ episodeId });
}

// ============================================================
// Q1 feature #5 — Request audiogram for an output
// ============================================================

const AUDIOGRAM_MIN_SPAN_MS = 15_000;
const AUDIOGRAM_MAX_SPAN_MS = 90_000;
const AUDIOGRAM_DEFAULT_END_MS = 60_000;

const requestAudiogramInput = z.object({
  outputId: z.string().min(1),
  /** Optional window override. Defaults to 0–60 s of the source audio. */
  startMs: z.number().int().min(0).optional(),
  endMs: z.number().int().min(1).optional(),
  aspect: z.enum(["1:1", "9:16"]).optional(),
});

export async function requestAudiogramAction(
  raw: unknown,
): Promise<ActionResult<{ outputId: string }>> {
  const parsed = requestAudiogramInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid audiogram-request input", parsed.error.issues);
  }
  const { outputId, startMs = 0, endMs = AUDIOGRAM_DEFAULT_END_MS, aspect = "9:16" } = parsed.data;

  if (endMs <= startMs) return { ok: false, error: "End time must be after start time." };
  const span = endMs - startMs;
  if (span < AUDIOGRAM_MIN_SPAN_MS) {
    return {
      ok: false,
      error: `Audiogram is too short — minimum ${AUDIOGRAM_MIN_SPAN_MS / 1000}s.`,
    };
  }
  if (span > AUDIOGRAM_MAX_SPAN_MS) {
    return {
      ok: false,
      error: `Audiogram is too long — maximum ${AUDIOGRAM_MAX_SPAN_MS / 1000}s.`,
    };
  }

  if (!isLiveDb()) return noopOk({ outputId });

  const auth = await requireAuthContext();
  // Tenant guard + prereq check: audio present, word timings present.
  // Also pull existing audiogramStatus to decide whether this counts as
  // a regen (see below).
  const output = await prisma.generatedOutput.findFirst({
    where: {
      id: outputId,
      episode: { show: { client: { agencyId: auth.agency.id } } },
    },
    select: {
      id: true,
      episodeId: true,
      audiogramStatus: true,
      episode: {
        select: { audioUrl: true, transcriptWords: true },
      },
    },
  });
  if (!output) throw new NotFoundError(`Output ${outputId} not found`);
  if (!output.episode.audioUrl) {
    return { ok: false, error: "This episode has no audio. Audiogram needs source audio." };
  }
  if (!output.episode.transcriptWords) {
    return {
      ok: false,
      error: "This episode has no transcript-word timings. Re-transcribe to enable audiogram.",
    };
  }

  // PricingV2 — first audiogram per output is free; regenerating (any
  // subsequent request against the same output row) counts as a regen.
  // `audiogramStatus == null` means we've never touched it.
  if (output.audiogramStatus !== null) {
    try {
      await assertAndConsumeRegen(auth.agency.id, auth.agency.plan, "audiogram");
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Persist window + aspect + PENDING status BEFORE firing the event so a
  // page refresh mid-render shows the right state.
  await prisma.generatedOutput.update({
    where: { id: outputId },
    data: {
      audiogramStatus: "PENDING",
      audiogramUrl: null,
      audiogramPosterUrl: null,
      audiogramError: null,
      audiogramStartMs: startMs,
      audiogramEndMs: endMs,
      audiogramAspect: aspect,
    },
  });

  await inngest.send({
    name: "output/audiogram.requested",
    data: { outputId, agencyId: auth.agency.id },
  });

  revalidatePath(`/episodes/${output.episodeId}`);
  return noopOk({ outputId });
}

// ============================================================
// Q1 feature #4 — Request AI hero artwork for an episode
// ============================================================

const requestArtworkInput = z.object({
  episodeId: z.string().min(1),
});

export async function requestArtworkAction(
  raw: unknown,
): Promise<ActionResult<{ episodeId: string }>> {
  const parsed = requestArtworkInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid artwork-request input", parsed.error.issues);
  }
  const { episodeId } = parsed.data;

  if (!isLiveDb()) return noopOk({ episodeId });

  const auth = await requireAuthContext();
  const episode = await prisma.episode.findFirst({
    where: {
      id: episodeId,
      show: { client: { agencyId: auth.agency.id } },
    },
    select: {
      id: true,
      transcript: true,
      heroImageUrl: true,
      squareCoverUrl: true,
      verticalCoverUrl: true,
    },
  });
  if (!episode) throw new NotFoundError(`Episode ${episodeId} not found`);
  if (!episode.transcript || episode.transcript.trim().length < 200) {
    return {
      ok: false,
      error:
        "Episode transcript is too short to derive a visual concept. Try again after transcription completes.",
    };
  }

  // PricingV2 — first artwork run per episode is free (bundled with
  // the episode). Subsequent runs (any variant already exists) count
  // as a regen and consume budget.
  const artworkExists = Boolean(
    episode.heroImageUrl || episode.squareCoverUrl || episode.verticalCoverUrl,
  );
  if (artworkExists) {
    try {
      await assertAndConsumeRegen(auth.agency.id, auth.agency.plan, "artwork");
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  await inngest.send({
    name: "episode/artwork.requested",
    data: { episodeId, agencyId: auth.agency.id },
  });

  revalidatePath(`/episodes/${episodeId}`);
  return noopOk({ episodeId });
}

// ============================================================
// Q1 wk7 — Retry a FAILED clip (same bounds)
// ============================================================

const retryClipInput = z.object({
  clipId: z.string().min(1),
  episodeId: z.string().min(1),
});

export async function retryClipAction(raw: unknown): Promise<ActionResult<{ clipId: string }>> {
  const parsed = retryClipInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid retry input", parsed.error.issues);
  }
  const { clipId, episodeId } = parsed.data;

  if (!isLiveDb()) return noopOk({ clipId });

  const auth = await requireAuthContext();
  const clip = await getClipById(auth.agency.id, clipId);
  if (!clip) throw new NotFoundError(`Clip ${clipId} not found`);
  if (clip.episodeId !== episodeId) {
    return { ok: false, error: "Clip does not belong to this episode." };
  }

  // Retry is a regen (worker will redo the ffmpeg pass) — consume budget.
  try {
    await assertAndConsumeRegen(auth.agency.id, auth.agency.plan, "clip");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Reuse the retrim event with unchanged bounds — same worker call
  // shape, so no separate Inngest fn.
  await inngest.send({
    name: "clip/retrim.requested",
    data: {
      clipId,
      agencyId: auth.agency.id,
      startMs: clip.startMs,
      endMs: clip.endMs,
    },
  });

  revalidatePath(`/episodes/${episodeId}/clips`);
  return noopOk({ clipId });
}

// ============================================================
// Q1 wk6 — Retrim a single clip
// ============================================================

const CLIP_MIN_SPAN_MS = 15_000;
const CLIP_MAX_SPAN_MS = 90_000;

const retrimClipInput = z.object({
  clipId: z.string().min(1),
  episodeId: z.string().min(1),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(1),
});

export async function retrimClipAction(raw: unknown): Promise<ActionResult<{ clipId: string }>> {
  const parsed = retrimClipInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid retrim input", parsed.error.issues);
  }
  const { clipId, episodeId, startMs, endMs } = parsed.data;

  if (!isLiveDb()) return noopOk({ clipId });

  if (endMs <= startMs) {
    return { ok: false, error: "End time must be after start time." };
  }
  const spanMs = endMs - startMs;
  if (spanMs < CLIP_MIN_SPAN_MS) {
    return { ok: false, error: `Clip is too short — minimum ${CLIP_MIN_SPAN_MS / 1000}s.` };
  }
  if (spanMs > CLIP_MAX_SPAN_MS) {
    return { ok: false, error: `Clip is too long — maximum ${CLIP_MAX_SPAN_MS / 1000}s.` };
  }

  const auth = await requireAuthContext();
  const clip = await getClipById(auth.agency.id, clipId);
  if (!clip) throw new NotFoundError(`Clip ${clipId} not found`);
  if (clip.episodeId !== episodeId) {
    return { ok: false, error: "Clip does not belong to this episode." };
  }

  // Trim + re-render is a clip regen.
  try {
    await assertAndConsumeRegen(auth.agency.id, auth.agency.plan, "clip");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  await inngest.send({
    name: "clip/retrim.requested",
    data: { clipId, agencyId: auth.agency.id, startMs, endMs },
  });

  revalidatePath(`/episodes/${episodeId}/clips`);
  return noopOk({ clipId });
}
