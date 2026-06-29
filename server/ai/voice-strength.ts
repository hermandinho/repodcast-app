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
