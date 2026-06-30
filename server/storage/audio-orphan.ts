import "server-only";

import type { R2ObjectSummary } from "./r2";

/**
 * Phase 2.7 — pure helpers behind the orphan-audio cleanup cron.
 *
 * Why split this out: the cron orchestration (R2 list, Prisma findMany,
 * R2 batch-delete) can't run in unit tests without a live bucket + DB,
 * but the parse + partition logic is the part that's easy to get wrong
 * (one-char shift in a key prefix silently nukes nothing — or worse,
 * silently nukes everything). Keeping it pure means we can pin it.
 *
 * Key shape (set in `signAudioUploadAction`):
 *   audio/<agencyId>/<showId>/<episodeId>.<ext>
 *
 * Each segment is non-empty; `.<ext>` is required and must contain a dot
 * in the last path segment. Anything not matching this shape is treated
 * as "unknown" and ignored — the cron never deletes a key it can't parse.
 */

export const AUDIO_KEY_PREFIX = "audio/";

export type ParsedAudioKey = {
  agencyId: string;
  showId: string;
  episodeId: string;
  ext: string;
};

/** Parse an `audio/...` key into its parts. Returns null on any mismatch. */
export function parseAudioKey(key: string): ParsedAudioKey | null {
  if (!key.startsWith(AUDIO_KEY_PREFIX)) return null;
  const parts = key.slice(AUDIO_KEY_PREFIX.length).split("/");
  if (parts.length !== 3) return null;
  const [agencyId, showId, basename] = parts;
  if (!agencyId || !showId || !basename) return null;
  const dot = basename.lastIndexOf(".");
  if (dot <= 0 || dot === basename.length - 1) return null;
  const episodeId = basename.slice(0, dot);
  const ext = basename.slice(dot + 1);
  if (!episodeId || !ext) return null;
  return { agencyId, showId, episodeId, ext };
}

export type OrphanCandidate = {
  key: string;
  episodeId: string;
};

export type PartitionResult = {
  /** Candidates whose episodeId is NOT in `existingIds` — safe to delete. */
  orphans: OrphanCandidate[];
  /** Candidates whose episodeId IS in `existingIds` — keep. */
  keepers: OrphanCandidate[];
};

/**
 * Split candidate audio objects by whether their pre-minted episodeId still
 * exists in the DB. Used by the cron after gathering R2 keys + the live
 * Episode id set.
 */
export function partitionOrphans(
  candidates: OrphanCandidate[],
  existingIds: ReadonlySet<string>,
): PartitionResult {
  const orphans: OrphanCandidate[] = [];
  const keepers: OrphanCandidate[] = [];
  for (const c of candidates) {
    (existingIds.has(c.episodeId) ? keepers : orphans).push(c);
  }
  return { orphans, keepers };
}

/**
 * Filter listed R2 objects to "old enough to be a real orphan candidate."
 * Anything newer than `minAge` is skipped — those are in-flight uploads
 * that just haven't had the wizard submitted yet.
 *
 * Objects missing `LastModified` are skipped (we don't know their age, and
 * deleting a 5-minute-old upload would torch a real user's work).
 */
export function filterAgedCandidates(
  objects: R2ObjectSummary[],
  now: Date,
  minAgeMs: number,
): OrphanCandidate[] {
  const cutoff = now.getTime() - minAgeMs;
  const out: OrphanCandidate[] = [];
  for (const obj of objects) {
    if (!obj.lastModified) continue;
    if (obj.lastModified.getTime() > cutoff) continue;
    const parsed = parseAudioKey(obj.key);
    if (!parsed) continue;
    out.push({ key: obj.key, episodeId: parsed.episodeId });
  }
  return out;
}
