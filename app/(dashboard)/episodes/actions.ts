"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import { bulkApproveOutputsForEpisodes } from "@/server/db/outputs";
import { isLiveDb } from "@/server/data/source";

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
