import "server-only";

/**
 * Pure voice-strength logic — shared by the AI pipeline (Inngest threshold
 * trigger for the voice-description refresh) and the UI helpers in
 * `lib/sample-data/voice-strength.ts`.
 *
 * Keep this module free of presentation concerns (colours, badge styles) so
 * server code never accidentally pulls UI types or the sample-data fixtures.
 */

export type VoiceLevel = "Weak" | "Developing" | "Strong";

/**
 * Threshold count where each level begins. A client crosses INTO the level
 * when the new approved-sample total is `>=` the entry value.
 */
export const VOICE_LEVEL_THRESHOLDS = {
  weak: 0,
  developing: 6,
  strong: 16,
} as const;

/**
 * Approved-sample counts at which we want to refresh the AI voice
 * description. The first item kicks off the very first profile; the rest
 * line up with the strength-level boundaries (Developing, Strong) plus a
 * "fully trained" milestone where we lock in the final profile.
 */
export const VOICE_REFRESH_THRESHOLDS = [
  1,
  VOICE_LEVEL_THRESHOLDS.developing,
  VOICE_LEVEL_THRESHOLDS.strong,
  30,
] as const;

export function voiceLevel(samples: number): VoiceLevel {
  if (samples >= VOICE_LEVEL_THRESHOLDS.strong) return "Strong";
  if (samples >= VOICE_LEVEL_THRESHOLDS.developing) return "Developing";
  return "Weak";
}

/**
 * Returns true when the new sample count just crossed one of the refresh
 * thresholds — i.e. `previous < threshold <= next`. Used by the
 * approve-output action to decide whether to fire the voice-refresh event.
 */
export function crossedVoiceRefreshThreshold(previous: number, next: number): boolean {
  if (next <= previous) return false;
  return VOICE_REFRESH_THRESHOLDS.some((t) => previous < t && next >= t);
}

/**
 * How many samples between periodic re-descriptions past the last fixed
 * milestone (30). At 30 the description is written once; at 45, 60, … it
 * refreshes again so a show that keeps approving stays represented by an
 * up-to-date profile instead of one frozen at the 30-sample snapshot.
 */
export const VOICE_PERIODIC_REFRESH_INTERVAL = 15;

/**
 * Recent-window mean edit-distance ratio at or above which we treat the
 * show's voice as having drifted. Operators consistently rewriting > 35%
 * of the AI's output signals the description no longer captures their
 * voice — burn a refresh even mid-band.
 */
export const VOICE_DRIFT_RATIO_THRESHOLD = 0.35;

/**
 * Minimum samples that must land between two drift-triggered refreshes.
 * Without this the same high-edit streak could re-fire the refresh on
 * every approval — expensive and unlikely to converge to a better
 * description.
 */
export const VOICE_DRIFT_COOLDOWN_SAMPLES = 5;

export type VoiceRefreshDecisionInput = {
  /** Approved-sample count immediately before this approval. */
  previousSampleCount: number;
  /** Approved-sample count immediately after this approval landed. */
  newSampleCount: number;
  /**
   * Sample count at the last successful voice-description refresh. `0`
   * means the description has never been written for this show.
   */
  sampleCountAtLastRefresh: number;
  /**
   * Mean of `editDistance / max(contentLength, 1)` across the recent
   * sample window (default: the same 10-sample window queried by the
   * caller). `undefined` when the pool is empty or no samples carry an
   * `editDistance` — treat as no signal, not zero drift.
   */
  recentDriftRatio: number | undefined;
};

/**
 * Central refresh gate. Fires when *any* of three conditions holds:
 *
 * 1. **Milestone crossing** — the original `VOICE_REFRESH_THRESHOLDS`
 *    boundaries (1, 6, 16, 30). Cheap, predictable, and it keeps the
 *    onboarding funnel intact.
 * 2. **Periodic past the last milestone** — every
 *    `VOICE_PERIODIC_REFRESH_INTERVAL` (15) samples once the show is
 *    past 30. The previous logic froze the description at the 30-sample
 *    snapshot; this keeps it representative as the show grows.
 * 3. **Drift trigger** — when the recent-window mean edit ratio crosses
 *    `VOICE_DRIFT_RATIO_THRESHOLD` (0.35), and the sample count has
 *    advanced at least `VOICE_DRIFT_COOLDOWN_SAMPLES` since the last
 *    refresh (so a heavy-edit streak doesn't refire on every approval).
 *
 * All decisions are pure — the caller supplies the state it already has
 * on hand from the approve transaction, and this function commits to a
 * boolean. No Prisma reads inside so we can unit-test the logic in
 * isolation.
 */
/**
 * Sample window used to compute the drift ratio the refresh gate reads.
 * Small enough to react to a recent shift, large enough that a single
 * heavy-edit outlier doesn't flip the average.
 */
export const VOICE_DRIFT_WINDOW_SIZE = 10;

/**
 * Mean edit ratio across the recent window. Each sample contributes
 * `min(1, editDistance / max(content.length, 1))` — clamped to 1 so a
 * total rewrite doesn't skew the average past what it represents.
 *
 * Returns `undefined` when the pool is empty OR nothing in the window
 * carries an `editDistance` (samples predating the tracking, or portal
 * samples with no linked output). Callers should treat that as "no
 * signal" rather than "zero drift".
 */
export function computeRecentDriftRatio(
  samples: ReadonlyArray<{ content: string; editDistance: number | null | undefined }>,
): number | undefined {
  const ratios: number[] = [];
  for (const s of samples) {
    if (s.editDistance === null || s.editDistance === undefined) continue;
    const length = Math.max(s.content.length, 1);
    ratios.push(Math.min(1, s.editDistance / length));
  }
  if (ratios.length === 0) return undefined;
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

export function shouldRefreshVoiceDescription(input: VoiceRefreshDecisionInput): boolean {
  const { previousSampleCount, newSampleCount, sampleCountAtLastRefresh, recentDriftRatio } = input;

  if (crossedVoiceRefreshThreshold(previousSampleCount, newSampleCount)) return true;

  const strongMilestone = VOICE_REFRESH_THRESHOLDS[VOICE_REFRESH_THRESHOLDS.length - 1];
  const samplesSinceLastRefresh = newSampleCount - sampleCountAtLastRefresh;

  if (
    newSampleCount > strongMilestone &&
    samplesSinceLastRefresh >= VOICE_PERIODIC_REFRESH_INTERVAL
  ) {
    return true;
  }

  if (
    recentDriftRatio !== undefined &&
    recentDriftRatio >= VOICE_DRIFT_RATIO_THRESHOLD &&
    samplesSinceLastRefresh >= VOICE_DRIFT_COOLDOWN_SAMPLES
  ) {
    return true;
  }

  return false;
}
