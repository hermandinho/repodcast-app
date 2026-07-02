"use server";

import { revalidatePath } from "next/cache";
import { ExternalScheduler } from "@prisma/client";
import { z } from "zod";
import { requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import { isLiveDb } from "@/server/data/source";
import { prisma } from "@/server/db/client";
import { getBufferIntegrationForAgency, isBufferSupportedPlatform } from "@/server/db/integrations";
import { markOutputPublished, scheduleOutput, unscheduleOutput } from "@/server/db/outputs";
import {
  createPost as bufferCreatePost,
  deletePost as bufferDeletePost,
  BufferError,
} from "@/server/integrations/buffer";

/**
 * Phase 3.3 — server actions backing the calendar + OutputCard scheduling
 * affordances. Actions handle mode-resolution (auto vs force-buffer vs
 * manual) and the Buffer round-trip; DB writes go through
 * `server/db/outputs.ts` helpers which enforce tenant scoping + role gates.
 */

export type ActionResult<T = void> =
  { ok: true; data: T } | { ok: false; error: string; errorCode?: string };

function noopOk<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

const scheduleInput = z.object({
  outputId: z.string().min(1),
  scheduledForIso: z.string().datetime(),
  mode: z.enum(["auto", "buffer", "manual"]).default("auto"),
});

/**
 * APPROVED → SCHEDULED. Mode-resolution:
 *   - `auto`   → BUFFER if the agency has a Buffer connection AND the
 *                platform is Buffer-supported; else MANUAL.
 *   - `buffer` → force Buffer; error if not connected or platform unsupported.
 *   - `manual` → force MANUAL regardless of Buffer state.
 *
 * When BUFFER is chosen, we POST to Buffer *before* the DB flip. If Buffer
 * fails, no DB write happens — the output stays APPROVED and the action
 * returns a Buffer-specific error the UI can surface.
 */
export async function scheduleOutputAction(raw: unknown): Promise<
  ActionResult<{
    outputId: string;
    scheduledFor: string;
    externalScheduler: ExternalScheduler;
    externalPostUrl: string | null;
  }>
> {
  const parsed = scheduleInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid schedule input", parsed.error.issues);
  }
  const { outputId, scheduledForIso, mode } = parsed.data;
  const scheduledFor = new Date(scheduledForIso);
  if (scheduledFor.getTime() <= Date.now()) {
    return { ok: false, error: "Scheduled time must be in the future." };
  }

  if (!isLiveDb()) {
    return noopOk({
      outputId,
      scheduledFor: scheduledFor.toISOString(),
      externalScheduler: ExternalScheduler.MANUAL,
      externalPostUrl: null,
    });
  }

  const auth = await requireAuthContext();
  const ctx = toTenantContext(auth);

  // Load the output (with tenant scoping) so we know its platform before
  // deciding mode. Also lets us fail fast on wrong-tenant ids.
  const output = await prisma.generatedOutput.findFirst({
    where: {
      id: outputId,
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
    select: { id: true, content: true, platform: true },
  });
  if (!output) {
    return { ok: false, error: "Output not found.", errorCode: "not_found" };
  }

  const integration = mode === "manual" ? null : await getBufferIntegrationForAgency(ctx);
  const supportsBuffer = isBufferSupportedPlatform(output.platform);
  let resolvedScheduler: ExternalScheduler;

  if (mode === "buffer") {
    if (!integration) {
      return {
        ok: false,
        error: "Buffer is not connected for this agency.",
        errorCode: "no_buffer",
      };
    }
    if (!supportsBuffer) {
      return {
        ok: false,
        error: `Buffer doesn't publish to ${output.platform}. Use manual mode.`,
        errorCode: "unsupported_platform",
      };
    }
    resolvedScheduler = ExternalScheduler.BUFFER;
  } else if (mode === "auto") {
    resolvedScheduler =
      integration && supportsBuffer ? ExternalScheduler.BUFFER : ExternalScheduler.MANUAL;
  } else {
    resolvedScheduler = ExternalScheduler.MANUAL;
  }

  let externalPostId: string | undefined;
  let externalPostUrl: string | undefined;

  if (resolvedScheduler === ExternalScheduler.BUFFER && integration) {
    const profileId = integration.meta.profiles[output.platform];
    if (!profileId) {
      return {
        ok: false,
        error: `Buffer has no ${output.platform} profile connected. Add it in Buffer, then reconnect.`,
        errorCode: "no_profile",
      };
    }
    try {
      const created = await bufferCreatePost({
        accessToken: integration.accessToken,
        channelId: profileId,
        text: output.content,
        dueAt: scheduledFor,
      });
      externalPostId = created.id;
      externalPostUrl = created.publicUrl ?? undefined;
    } catch (err) {
      if (err instanceof BufferError) {
        return {
          ok: false,
          error: `Buffer rejected the post: ${err.message}`,
          errorCode: "buffer_error",
        };
      }
      throw err;
    }
  }

  const updated = await scheduleOutput(ctx, outputId, auth.member.id, {
    scheduledFor,
    externalScheduler: resolvedScheduler,
    externalPostId,
    externalPostUrl,
  });

  revalidatePath("/schedule");
  revalidatePath(`/episodes/${updated.episodeId}`);

  return noopOk({
    outputId: updated.id,
    scheduledFor: updated.scheduledFor?.toISOString() ?? scheduledFor.toISOString(),
    externalScheduler: resolvedScheduler,
    externalPostUrl: externalPostUrl ?? null,
  });
}

const unscheduleInput = z.object({ outputId: z.string().min(1) });

/**
 * SCHEDULED → APPROVED. If the output was pushed to Buffer, we call
 * Buffer's delete endpoint first (best-effort — a 404 is fine, we still
 * do the DB downgrade). Buffer failures on non-404 are logged but not
 * fatal — the calendar surface always trusts local state.
 */
export async function unscheduleOutputAction(
  raw: unknown,
): Promise<ActionResult<{ outputId: string }>> {
  const parsed = unscheduleInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid unschedule input", parsed.error.issues);
  }
  const { outputId } = parsed.data;

  if (!isLiveDb()) return noopOk({ outputId });

  const auth = await requireAuthContext();
  const ctx = toTenantContext(auth);

  const output = await prisma.generatedOutput.findFirst({
    where: {
      id: outputId,
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
    select: { id: true, externalScheduler: true, externalPostId: true, episodeId: true },
  });
  if (!output) return { ok: false, error: "Output not found.", errorCode: "not_found" };

  if (output.externalScheduler === ExternalScheduler.BUFFER && output.externalPostId) {
    const integration = await getBufferIntegrationForAgency(ctx);
    if (integration) {
      try {
        await bufferDeletePost({
          accessToken: integration.accessToken,
          id: output.externalPostId,
        });
      } catch (err) {
        // Log + continue — local downgrade is still correct even if Buffer
        // is unreachable. Worst case the post fires on Buffer's side and
        // the sync cron picks it back up on the next pass (we'll see it as
        // PUBLISHED-on-Buffer / APPROVED-locally and re-flip).
        console.error("buffer deleteUpdate failed", err);
      }
    }
  }

  const updated = await unscheduleOutput(ctx, outputId, auth.member.id);

  revalidatePath("/schedule");
  revalidatePath(`/episodes/${updated.episodeId}`);

  return noopOk({ outputId: updated.id });
}

const markPublishedActionInput = z.object({
  outputId: z.string().min(1),
  publishedAtIso: z.string().datetime().optional(),
  externalPostUrl: z.string().url().optional(),
});

/**
 * MANUAL "Mark published" affordance. Buffer-backed rows shouldn't route
 * through here (the sync cron owns them) — we still allow it as an
 * operator override, but the UI hides the button on BUFFER-scheduled rows.
 */
export async function markOutputPublishedAction(
  raw: unknown,
): Promise<ActionResult<{ outputId: string; publishedAt: string }>> {
  const parsed = markPublishedActionInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid mark-published input", parsed.error.issues);
  }
  const { outputId, publishedAtIso, externalPostUrl } = parsed.data;

  if (!isLiveDb())
    return noopOk({ outputId, publishedAt: publishedAtIso ?? new Date().toISOString() });

  const auth = await requireAuthContext();
  const ctx = toTenantContext(auth);

  const updated = await markOutputPublished(ctx, outputId, auth.member.id, {
    publishedAt: publishedAtIso ? new Date(publishedAtIso) : undefined,
    externalPostUrl,
  });

  revalidatePath("/schedule");
  revalidatePath(`/episodes/${updated.episodeId}`);

  return noopOk({
    outputId: updated.id,
    publishedAt: updated.publishedAt?.toISOString() ?? new Date().toISOString(),
  });
}
