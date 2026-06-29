import { voiceSegments } from "@/lib/sample-data/voice-strength";

type Size = "sm" | "md" | "lg";

const sizes: Record<Size, { height: number; radius: number; gap: number; width?: number }> = {
  sm: { height: 6, radius: 3, gap: 4 },
  md: { height: 7, radius: 4, gap: 5 },
  lg: { height: 7, radius: 4, gap: 4, width: 20 },
};

export function VoiceStrengthBars({ samples, size = "md" }: { samples: number; size?: Size }) {
  const segs = voiceSegments(samples);
  const s = sizes[size];
  return (
    <span className="flex" style={{ gap: s.gap }} aria-label={`Voice strength: ${samples} samples`}>
      {segs.map((color, i) => (
        <span
          key={i}
          style={{
            background: color,
            height: s.height,
            borderRadius: s.radius,
            width: s.width,
            flex: s.width ? undefined : 1,
            display: "block",
          }}
        />
      ))}
    </span>
  );
}
