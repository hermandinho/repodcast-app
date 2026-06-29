export type VoiceLevel = "Weak" | "Developing" | "Strong";

const STRONG = "#2E9E5B";
const DEVELOPING = "#3A5BA0";
const WEAK = "#C9952B";
const INACTIVE = "#E3E8F1";

const STRONG_BG = "#E7F4EC";
const DEVELOPING_BG = "#EEF2FB";
const WEAK_BG = "#FBF1DE";

const STRONG_TEXT = "#1E7A47";
const DEVELOPING_TEXT = "#3A5BA0";
const WEAK_TEXT = "#A06D12";

/** Returns the 3 segment colors for a voice-strength meter. */
export function voiceSegments(samples: number): [string, string, string] {
  const level = samples >= 16 ? 3 : samples >= 6 ? 2 : 1;
  const color = samples >= 16 ? STRONG : samples >= 6 ? DEVELOPING : WEAK;
  return [
    level >= 1 ? color : INACTIVE,
    level >= 2 ? color : INACTIVE,
    level >= 3 ? color : INACTIVE,
  ];
}

export function voiceLabel(samples: number): VoiceLevel {
  return samples >= 16 ? "Strong" : samples >= 6 ? "Developing" : "Weak";
}

/** Foreground/text color matching the strength level. */
export function voiceColor(samples: number): string {
  return samples >= 16 ? STRONG : samples >= 6 ? DEVELOPING : WEAK;
}

/** Pill text color (slightly darker than voiceColor for AA contrast on light bg). */
export function voiceTextColor(samples: number): string {
  return samples >= 16 ? STRONG_TEXT : samples >= 6 ? DEVELOPING_TEXT : WEAK_TEXT;
}

/** Soft background color for badges/pills. */
export function voiceBg(samples: number): string {
  return samples >= 16 ? STRONG_BG : samples >= 6 ? DEVELOPING_BG : WEAK_BG;
}
