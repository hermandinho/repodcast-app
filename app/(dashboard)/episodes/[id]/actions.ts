"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import { crossedVoiceRefreshThreshold } from "@/server/ai/voice-strength";
import { isLiveDb } from "@/server/data/source";
import { prisma } from "@/server/db/client";
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
