import "server-only";

import { VOICE_LEVEL_THRESHOLDS } from "@/server/ai/voice-strength";
import type { VoiceProgressPoint, VoiceProgressResult } from "@/lib/voice-progress-shape";

export type { VoiceProgressPoint, VoiceProgressResult } from "@/lib/voice-progress-shape";

/**
 * Pure voice-progress aggregation — takes shipped `GeneratedOutput` rows
 * for one show and derives the "% posted unedited" curve that
 * `<VoiceProgressCard>` renders. All presentation lives in the client
 * component; this module stays framework-agnostic and unit-testable in
 * isolation (mirrors `voice-strength.ts`).
 *
 * The headline metric is deliberately **post-ready** (edit ratio
 * `<= 0.10`) rather than exact-zero. A one-character fix shouldn't count
 * as "edited"; the 10% floor is less noisy while still honest to the
 * promise "post it without rewriting."
 */

// ============================================================
// Constants
// ============================================================

/**
 * Earliest `createdAt` we count. `editDistance` was added on this date
 * (`prisma/migrations/20260629043709_strip/migration.sql`) — anything
 * older reports `editDistance = 0` because the column defaulted, not
 * because the operator shipped it clean. Counting those would inflate
 * the metric on shows with pre-migration history.
 */
export const EDIT_TRACKING_SINCE = new Date("2026-06-29T00:00:00Z");

/**
 * Edit-ratio ceiling at which we still call an output "post-ready" —
 * shipped without meaningful edits. 10% is loose enough that a typo
 * fix doesn't disqualify it, tight enough that a real rewrite does.
 * If you tune this, tune the north-star copy too.
 */
export const POST_READY_MAX_RATIO = 0.1;

/**
 * How many recent shipped outputs the headline % is computed over.
 * Chosen so a single bad episode can't drag the number down, but
 * ~2 weeks of activity is enough to flip it.
 */
export const HEADLINE_WINDOW = 30;

// ============================================================
// Types
// ============================================================

/**
 * One shipped output row as this module needs it. The caller (data
 * source layer) does the tenant-scoped Prisma query and shapes rows
 * into this. Keeping the field set tight makes the aggregation cheap
 * to unit-test without a Prisma harness.
 */
export type ShippedOutputRow = {
  outputId: string;
  episodeId: string;
  episodeTitle: string;
  /** `Episode.createdAt` — used to order episodes chronologically. */
  episodeCreatedAt: Date;
  platform: string;
  editDistance: number;
  /**
   * `content.length` on the shipped row. Passed through so the ratio
   * math stays server-side; the client component only sees the derived
   * `postReadyRate`.
   */
  contentLength: number;
};

/*
 * `VoiceProgressPoint` + `VoiceProgressResult` are re-exported from
 * `lib/voice-progress-shape.ts` — that module has no `server-only`
 * guard so the client-side `<VoiceProgressCard>` can consume the shape
 * without pulling this file (and `voice-strength.ts`) into its bundle.
 */

// ============================================================
// Aggregation
// ============================================================

/**
 * Turns shipped output rows into the series + headline the card
 * renders. **Pure** — no Prisma, no clock; callers pre-filter by
 * `EDIT_TRACKING_SINCE` and dedupe `(episodeId, platform)` at the
 * query layer.
 *
 * Contract:
 *   - Episodes are ordered by `episodeCreatedAt` ascending. Rows with
 *     the same `episodeId` collapse into one point whose
 *     `postReadyRate` is the mean over that episode's rows.
 *   - Headline is over the last `HEADLINE_WINDOW` rows chronologically
 *     (not per-episode averages — the buyer cares about raw output
 *     quality, not episode-level noise).
 *   - Milestones read cumulative row count episode-by-episode.
 */
export function computeVoiceProgress(rows: readonly ShippedOutputRow[]): VoiceProgressResult {
  if (rows.length === 0) {
    return {
      series: [],
      headline: { postReadyRate: null, sampleCount: 0, window: HEADLINE_WINDOW },
      milestones: { developing: null, strong: null },
    };
  }

  // Chronological — episodes first-by-createdAt, ties broken by outputId
  // so the ordering is deterministic across runs.
  const sorted = [...rows].sort((a, b) => {
    const da = a.episodeCreatedAt.getTime();
    const db = b.episodeCreatedAt.getTime();
    if (da !== db) return da - db;
    return a.outputId.localeCompare(b.outputId);
  });

  // Group by episodeId, preserving encounter order → that's chronological.
  const byEpisode = new Map<string, { title: string; postReadySum: number; sampleCount: number }>();
  for (const row of sorted) {
    const bucket = byEpisode.get(row.episodeId) ?? {
      title: row.episodeTitle,
      postReadySum: 0,
      sampleCount: 0,
    };
    bucket.postReadySum += isPostReady(row) ? 1 : 0;
    bucket.sampleCount += 1;
    byEpisode.set(row.episodeId, bucket);
  }

  const series: VoiceProgressPoint[] = [];
  let index = 0;
  let cumulative = 0;
  let developingIndex: number | null = null;
  let strongIndex: number | null = null;
  for (const [episodeId, bucket] of byEpisode) {
    index += 1;
    cumulative += bucket.sampleCount;
    if (developingIndex === null && cumulative >= VOICE_LEVEL_THRESHOLDS.developing) {
      developingIndex = index;
    }
    if (strongIndex === null && cumulative >= VOICE_LEVEL_THRESHOLDS.strong) {
      strongIndex = index;
    }
    series.push({
      episodeIndex: index,
      episodeId,
      title: bucket.title,
      postReadyRate: bucket.postReadySum / bucket.sampleCount,
      sampleCount: bucket.sampleCount,
    });
  }

  // Headline: last `HEADLINE_WINDOW` rows chronologically. Row-level, not
  // episode-averaged — the buyer sees "% posted unedited on the last 30
  // things I shipped."
  const tail = sorted.slice(Math.max(0, sorted.length - HEADLINE_WINDOW));
  const tailPostReady = tail.reduce((n, r) => n + (isPostReady(r) ? 1 : 0), 0);
  const headline = {
    postReadyRate: tail.length > 0 ? tailPostReady / tail.length : null,
    sampleCount: tail.length,
    window: HEADLINE_WINDOW,
  };

  return {
    series,
    headline,
    milestones: { developing: developingIndex, strong: strongIndex },
  };
}

// ============================================================
// Per-row helpers (exported for the drawer readout + tests)
// ============================================================

/**
 * `editDistance / max(contentLength, 1)`, clamped to [0, 1]. Callers
 * that render "shipped X% unedited" want `1 - editRatio`.
 */
export function editRatioFor(row: { editDistance: number; contentLength: number }): number {
  const len = Math.max(row.contentLength, 1);
  const raw = row.editDistance / len;
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(1, raw);
}

/**
 * True when the row shipped with ≤ `POST_READY_MAX_RATIO` of its
 * content edited. This is the north-star bit.
 */
export function isPostReady(row: { editDistance: number; contentLength: number }): boolean {
  return editRatioFor(row) <= POST_READY_MAX_RATIO;
}

/**
 * Simple centered rolling average over the series' `postReadyRate`.
 * Windows shorter than requested at the ends (edges use whatever is
 * available) so the smoothed curve still starts at episode 1.
 * Returns a new array — original series is untouched.
 */
export function smoothSeries(
  series: readonly VoiceProgressPoint[],
  window: number,
): VoiceProgressPoint[] {
  if (window <= 1 || series.length === 0) return series.slice();
  const half = Math.floor(window / 2);
  const smoothed: VoiceProgressPoint[] = [];
  for (let i = 0; i < series.length; i += 1) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(series.length, i + half + 1);
    let sum = 0;
    for (let j = lo; j < hi; j += 1) sum += series[j].postReadyRate;
    smoothed.push({
      ...series[i],
      postReadyRate: sum / (hi - lo),
    });
  }
  return smoothed;
}
