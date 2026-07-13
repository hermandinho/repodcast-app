import { prisma } from "@/server/db/client";
import {
  AUDIO_KEY_PREFIX,
  filterAgedCandidates,
  partitionOrphans,
} from "@/server/storage/audio-orphan";
import { deleteR2Objects, getR2Client, listR2Objects } from "@/server/storage/r2";
import { inngest } from "../client";

/**
 * Orphan-audio cleanup cron. Deletes R2 audio objects that
 * are no longer referenced by any Episode row.
 *
 * ## Bail-out uploads (tier 1)
 * The "Upload audio" wizard step signs a pre-mint R2 PUT and the browser
 * streams the file straight to the bucket *before* the wizard's submit
 * step actually creates the Episode row. If the user closes the tab in
 * between (or the post-PUT submit fails), the R2 object is left behind
 * with no DB row referencing it. Left alone these accumulate — agencies
 * commonly cancel mid-upload — and R2 storage isn't free.
 *
 * ## Why the "audio-for-finished-episodes" tier was retired
 * The original design also deleted audio for episodes in READY /
 * ARCHIVED status on the assumption that "everything downstream runs
 * off Episode.transcript." That assumption held initially, but
 * two features shipped later actively re-read the audio:
 *
 *   - Feature #1 clips: `resolveClipSource()` falls back to `audioUrl`
 *     for UPLOAD-source episodes with no `sourceVideoUrl`.
 *   - Feature #5 audiograms: every render (first + regen) needs the
 *     source audio to draw the waveform + drive the caption timing.
 *
 * Deleting the audio meant every regen attempt on an older episode
 * failed with a confusing "no audio" error, and users had no easy way
 * to restore it. The savings weren't worth the data-loss bug — at 40 MB
 * average and R2's $0.015/GB/mo storage, keeping every episode's audio
 * forever costs ~$0.60 per 1,000 episodes/mo. If retention ever becomes
 * a real concern we can add an explicit "archive before N days" policy
 * with a per-agency opt-in, rather than a global sweep.
 *
 * ## Schedule
 * Every 6 hours (00:00 / 06:00 / 12:00 / 18:00 UTC). Two-hour age floor
 * on the candidate list is the real safety belt — schedule slop only
 * delays cleanup, never advances it. Skip gracefully when R2 isn't
 * configured (dev / sample-data).
 */

const MIN_AGE_MS = 2 * 60 * 60 * 1000;
const PRISMA_LOOKUP_CHUNK = 500; // keep the IN-clause comfortably under any DB plan-cache limit

export const cleanupOrphanAudio = inngest.createFunction(
  {
    id: "cleanup-orphan-audio",
    triggers: [{ cron: "0 */6 * * *" }],
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
      return {
        scanned: objects.length,
        candidates: 0,
        deletedOrphans: 0,
        deletedDone: 0,
        ranAt: now.toISOString(),
      };
    }

    // ---- 3. One Prisma round-trip per chunk — we only need to know which
    // episodeIds still exist. Rows that exist mean the audio is referenced;
    // rows that don't mean the R2 object is orphaned (bail-out upload).
    // Chunked so a 5k-orphan backlog doesn't slam the DB with one giant
    // IN-clause. ----
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
        deletedOrphans: 0,
        ranAt: now.toISOString(),
      };
    }

    // ---- 4. Batch delete from R2. Wrap in step.run so a partial-batch
    // failure is memoized and the retry doesn't re-list the bucket. ----
    const deleted = await step.run("delete-audio", () =>
      deleteR2Objects(orphans.map((o) => o.key)),
    );

    return {
      scanned: objects.length,
      candidates: candidates.length,
      kept: keepers.length,
      deletedOrphans: orphans.length,
      deleted,
      ranAt: now.toISOString(),
    };
  },
);
