"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Platform } from "@prisma/client";
import { requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import { bulkGenerateEpisodes } from "@/server/db/episodes";
import { bulkApproveOutputsForEpisodes } from "@/server/db/outputs";
import { isLiveDb } from "@/server/data/source";
import { inngest } from "@/inngest/client";

export type BulkApproveResult =
  | {
      ok: true;
      data: {
        totalApproved: number;
        byEpisode: Record<string, number>;
        episodeCount: number;
      };
    }
  | { ok: false; error: string };

const bulkApproveInput = z.object({
  episodeIds: z.array(z.string().min(1)).min(1).max(50),
});

/**
 * Approve every READY / IN_REVIEW output across the supplied episode ids in
 * a single tenant-scoped transaction. Used by the `/episodes` list page's
 * checkbox + "Approve N selected" bar.
 */
export async function bulkApproveEpisodesAction(raw: unknown): Promise<BulkApproveResult> {
  const parsed = bulkApproveInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid bulk-approve input", parsed.error.issues);
  }

  // Sample-data mode is read-only — no rows to mutate. Return a synthetic
  // success so the UI flow stays demoable.
  if (!isLiveDb()) {
    const byEpisode: Record<string, number> = {};
    for (const id of parsed.data.episodeIds) byEpisode[id] = 7;
    return {
      ok: true,
      data: {
        totalApproved: parsed.data.episodeIds.length * 7,
        byEpisode,
        episodeCount: parsed.data.episodeIds.length,
      },
    };
  }

  const auth = await requireAuthContext();
  const { totalApproved, byEpisode } = await bulkApproveOutputsForEpisodes(
    toTenantContext(auth),
    parsed.data.episodeIds,
    auth.member.id,
  );

  // Same revalidation set as the per-output approve action: episodes (status
  // pills + counts), voice (voice-strength bars), clients (rolled-up counts).
  revalidatePath("/episodes", "layout");
  revalidatePath("/voice", "layout");
  revalidatePath("/clients", "layout");

  return {
    ok: true,
    data: {
      totalApproved,
      byEpisode,
      episodeCount: parsed.data.episodeIds.length,
    },
  };
}

// ============================================================
// Phase 2.6 — batch generate
// ============================================================

export type BulkGenerateResult =
  | {
      ok: true;
      data: {
        /** Episodes whose generation pipeline was actually dispatched. */
        dispatchedCount: number;
        /** Episodes that were selected but skipped because their status
         *  doesn't permit a retry (READY/PROCESSING/ARCHIVED). */
        skippedCount: number;
      };
    }
  | { ok: false; error: string };

const bulkGenerateInputSchema = z.object({
  episodeIds: z.array(z.string().min(1)).min(1).max(50),
});

/**
 * Fan out `episode/generate.requested` for every eligible episode in the
 * selection. Eligibility (status ∈ {DRAFT, FAILED}) + tenant filter +
 * status flip live in the repo helper; here we only wire the Inngest
 * dispatch and the post-write revalidate.
 *
 * Dispatches happen with `Promise.allSettled` so a single Inngest blip
 * doesn't lose the whole batch — the repo helper has already flipped
 * the rows to PROCESSING, so a dropped dispatch just means that row
 * dangles until the user retries (rare; Inngest is reliable).
 */
export async function bulkGenerateEpisodesAction(raw: unknown): Promise<BulkGenerateResult> {
  const parsed = bulkGenerateInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid bulk-generate input", parsed.error.issues);
  }

  if (!isLiveDb()) {
    return {
      ok: true,
      data: {
        dispatchedCount: parsed.data.episodeIds.length,
        skippedCount: 0,
      },
    };
  }

  const auth = await requireAuthContext();
  const tenant = toTenantContext(auth);
  const { dispatches, skippedNotEligible } = await bulkGenerateEpisodes(tenant, parsed.data);

  if (dispatches.length > 0) {
    // Phase 3.5 — tag the event with plan + agencyId so the priority.run
    // expression on `generate-episode` can bump NETWORK ahead and the
    // per-agency concurrency key caps this batch to N slots. Uses the
    // plan on auth (rather than `getAgencyPlan`) since it's already
    // loaded — see `episodes/new/actions.ts` for the tradeoff rationale.
    const plan = auth.agency.plan;
    const agencyId = tenant.agencyId;
    await Promise.allSettled(
      dispatches.map((d) =>
        inngest.send({
          name: "episode/generate.requested",
          data: {
            episodeId: d.episodeId,
            platforms: d.platforms as Platform[],
            plan,
            agencyId,
          },
        }),
      ),
    );
  }

  // Status pills on the list flip from DRAFT/FAILED → PROCESSING; the
  // dashboard's recent-episodes panel + sidebar counts read off the same
  // tree. Revalidate the whole episodes layout to keep them in sync.
  revalidatePath("/episodes", "layout");

  return {
    ok: true,
    data: {
      dispatchedCount: dispatches.length,
      skippedCount: skippedNotEligible.length,
    },
  };
}
