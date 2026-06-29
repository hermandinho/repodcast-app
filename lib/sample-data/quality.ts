/** Color for a quality score bar/text. */
export function qualityColor(score: number): string {
  if (score >= 85) return "#2E9E5B";
  if (score >= 72) return "#3A5BA0";
  return "#C9952B";
}
