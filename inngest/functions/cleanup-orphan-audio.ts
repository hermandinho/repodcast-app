import { prisma } from "@/server/db/client";
import {
  AUDIO_KEY_PREFIX,
  filterAgedCandidates,
  partitionOrphans,
} from "@/server/storage/audio-orphan";
import { deleteR2Objects, getR2Client, listR2Objects } from "@/server/storage/r2";
import { inngest } from "../client";

/**
 * Phase 2.7 — orphan-audio cleanup cron.
 *
 * The "Upload audio" wizard step signs a pre-mint R2 PUT and the browser
 * streams the file straight to the bucket *before* the wizard's submit
 * step actually creates the Episode row. If the user closes the tab in
 * between (or the post-PUT submit fails), the R2 object is left behind
 * with no DB row referencing it. Left alone these accumulate — agencies
 * commonly cancel mid-upload — and R2 storage isn't free.
 *
 * The key shape `audio/<agencyId>/<showId>/<episodeId>.<ext>` lets us
 * decide "orphan" cheaply: parse the episodeId, ask Prisma if that row
 * exists, delete the key if it doesn't. No "soft-delete on Episode delete"
 * timing window to worry about — the cron is the safety net for both
 * bail-out uploads AND any future delete path that forgets to clean R2.
 *
 * Schedule: daily at 03:00 UTC — off-peak, gives us most of a day's worth
 * of fresh-uploads-just-pending-submit beyond the 24h cutoff so we don't
 * yank an in-progress upload. The 24h floor (set in `MIN_AGE_MS`) is the
 * real safety belt — schedule slop only delays cleanup, never advances it.
 *
 * Skip gracefully when R2 isn't configured (dev / sample-data) — same
 * pattern as the email helpers.
 */

const MIN_AGE_MS = 24 * 60 * 60 * 1000;
const PRISMA_LOOKUP_CHUNK = 500; // keep the IN-clause comfortably under any DB plan-cache limit

export const cleanupOrphanAudio = inngest.createFunction(
  {
    id: "cleanup-orphan-audio",
    triggers: [{ cron: "0 3 * * *" }],
    retries: 3,
  },
  async ({ step }) => {
    if (!getR2Client()) {
      // No R2 configured — nothing to walk. Log + return so the run is
      // visible in the Inngest dashboard but doesn't error.
      return { skipped: "r2-not-configured", deleted: 0, scanned: 0 };
    }

    const now = new Date();

    // ---- 1. List every key under `audio/`. Read OUTSIDE step.run so a
    // retry sees the fresh bucket state instead of a memoized snapshot. ----
    const objects = await listR2Objects(AUDIO_KEY_PREFIX);

    // ---- 2. Narrow to "aged + parseable" candidates. ----
    const candidates = filterAgedCandidates(objects, now, MIN_AGE_MS);
    if (candidates.length === 0) {
      return { scanned: objects.length, candidates: 0, deleted: 0, ranAt: now.toISOString() };
    }

    // ---- 3. Ask Prisma which of those episodeIds still exist. Chunked so
    // a 5k-orphan backlog doesn't slam the DB with one giant IN-clause. ----
    const existingIds = new Set<string>();
    const candidateIds = Array.from(new Set(candidates.map((c) => c.episodeId)));
    for (let i = 0; i < candidateIds.length; i += PRISMA_LOOKUP_CHUNK) {
      const slice = candidateIds.slice(i, i + PRISMA_LOOKUP_CHUNK);
      const rows = await prisma.episode.findMany({
        where: { id: { in: slice } },
        select: { id: true },
      });
      for (const r of rows) existingIds.add(r.id);
    }

    const { orphans, keepers } = partitionOrphans(candidates, existingIds);
    if (orphans.length === 0) {
      return {
        scanned: objects.length,
        candidates: candidates.length,
        kept: keepers.length,
        deleted: 0,
        ranAt: now.toISOString(),
      };
    }

    // ---- 4. Batch delete. Wrap in step.run so a partial-batch failure
    // is memoized and the retry doesn't re-list the bucket from scratch. ----
    const deleted = await step.run("delete-orphans", () =>
      deleteR2Objects(orphans.map((o) => o.key)),
    );

    return {
      scanned: objects.length,
      candidates: candidates.length,
      kept: keepers.length,
      deleted,
      ranAt: now.toISOString(),
    };
  },
);
