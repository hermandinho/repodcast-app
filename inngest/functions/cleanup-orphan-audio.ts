import { EpisodeStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import {
  AUDIO_KEY_PREFIX,
  filterAgedCandidates,
  partitionOrphans,
} from "@/server/storage/audio-orphan";
import { deleteR2Objects, getR2Client, listR2Objects } from "@/server/storage/r2";
import { inngest } from "../client";

/**
 * Phase 2.7 — orphan-audio cleanup cron. Runs two tiers in one pass:
 *
 * Tier 1 — bail-out uploads.
 * The "Upload audio" wizard step signs a pre-mint R2 PUT and the browser
 * streams the file straight to the bucket *before* the wizard's submit
 * step actually creates the Episode row. If the user closes the tab in
 * between (or the post-PUT submit fails), the R2 object is left behind
 * with no DB row referencing it. Left alone these accumulate — agencies
 * commonly cancel mid-upload — and R2 storage isn't free.
 *
 * Tier 2 — audio for finished episodes.
 * Once transcription lands and the episode reaches READY or ARCHIVED,
 * the audio has done its job — everything downstream (generation,
 * outputs, KPIs) runs off `Episode.transcript`. Keep it for FAILED
 * (`retranscribeEpisodeAction` still expects the R2 key) and for
 * DRAFT / PROCESSING (transcription hasn't lifted the transcript off
 * the audio yet). Trade-off acknowledged: a user who later dislikes a
 * READY episode's Deepgram output has to paste a transcript manually
 * (`updateEpisodeTranscriptAction`) instead of re-running Deepgram —
 * cheaper than paying to hold every mp3 forever.
 *
 * The key shape `audio/<agencyId>/<showId>/<episodeId>.<ext>` lets us
 * decide both tiers cheaply: parse the episodeId, one Prisma round-trip
 * gets existence + status.
 *
 * Schedule: every 6 hours (00:00 / 06:00 / 12:00 / 18:00 UTC). Once-a-day
 * at 03:00 wasn't keeping up — bail-out uploads piled up between runs, and
 * the 24h age floor meant a morning cancel wasn't even a candidate until
 * the *next* night's cron. 2h is well past the wizard's normal
 * upload-then-submit window (seconds to a couple minutes) but short enough
 * that a tab left open all afternoon isn't going to leak. The age floor
 * (set in `MIN_AGE_MS`) is the real safety belt — schedule slop only
 * delays cleanup, never advances it.
 *
 * Skip gracefully when R2 isn't configured (dev / sample-data) — same
 * pattern as the email helpers.
 */

const MIN_AGE_MS = 2 * 60 * 60 * 1000;
const PRISMA_LOOKUP_CHUNK = 500; // keep the IN-clause comfortably under any DB plan-cache limit

/**
 * Episode statuses where the audio file is no longer needed. FAILED is
 * intentionally excluded — the retranscribe path re-reads `audioUrl`.
 */
const AUDIO_DONE_STATUSES: ReadonlySet<EpisodeStatus> = new Set<EpisodeStatus>([
  EpisodeStatus.READY,
  EpisodeStatus.ARCHIVED,
]);

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

    // ---- 3. One Prisma round-trip per chunk pulls id + status, so tier 1
    // (row missing = orphan) and tier 2 (row is READY/ARCHIVED = audio done)
    // share the same lookup. Chunked so a 5k-orphan backlog doesn't slam
    // the DB with one giant IN-clause. ----
    const idToStatus = new Map<string, EpisodeStatus>();
    const candidateIds = Array.from(new Set(candidates.map((c) => c.episodeId)));
    for (let i = 0; i < candidateIds.length; i += PRISMA_LOOKUP_CHUNK) {
      const slice = candidateIds.slice(i, i + PRISMA_LOOKUP_CHUNK);
      const rows = await prisma.episode.findMany({
        where: { id: { in: slice } },
        select: { id: true, status: true },
      });
      for (const r of rows) idToStatus.set(r.id, r.status);
    }

    const existingIds = new Set(idToStatus.keys());
    const { orphans, keepers } = partitionOrphans(candidates, existingIds);

    // Tier 2 split: of the keepers, which ones have finished their pipeline?
    const doneAudio = keepers.filter((k) => {
      const s = idToStatus.get(k.episodeId);
      return s != null && AUDIO_DONE_STATUSES.has(s);
    });

    const toDelete = [...orphans, ...doneAudio];
    if (toDelete.length === 0) {
      return {
        scanned: objects.length,
        candidates: candidates.length,
        kept: keepers.length,
        deletedOrphans: 0,
        deletedDone: 0,
        ranAt: now.toISOString(),
      };
    }

    // ---- 4. Batch delete from R2. Wrap in step.run so a partial-batch
    // failure is memoized and the retry doesn't re-list the bucket. ----
    const deleted = await step.run("delete-audio", () =>
      deleteR2Objects(toDelete.map((o) => o.key)),
    );

    // ---- 5. Null `audioUrl` on the tier-2 rows so the UI reflects
    // "no audio on file" and any future retranscribe attempt errors
    // cleanly ("No audio file on file — upload one before retrying.")
    // instead of signing a URL that 404s. Orphans skip this — there's
    // no row to update. Wrapped in step.run so the R2-delete result
    // stays committed even if this update fails and Inngest retries. ----
    if (doneAudio.length > 0) {
      await step.run("null-audio-url", async () => {
        await prisma.episode.updateMany({
          where: { id: { in: doneAudio.map((d) => d.episodeId) } },
          data: { audioUrl: null },
        });
      });
    }

    return {
      scanned: objects.length,
      candidates: candidates.length,
      kept: keepers.length - doneAudio.length,
      deletedOrphans: orphans.length,
      deletedDone: doneAudio.length,
      deleted,
      ranAt: now.toISOString(),
    };
  },
);
