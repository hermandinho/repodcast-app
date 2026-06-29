import type { PlatformMeta } from "@/lib/sample-data/platforms";

type Size = "sm" | "md";

const sizes: Record<Size, { box: number; radius: number; font: number }> = {
  sm: { box: 26, radius: 7, font: 11 },
  md: { box: 30, radius: 8, font: 12 },
};

export function PlatformBadge({ platform, size = "md" }: { platform: PlatformMeta; size?: Size }) {
  const s = sizes[size];
  return (
    <span
      className="font-display flex flex-shrink-0 items-center justify-center font-bold"
      style={{
        width: s.box,
        height: s.box,
        borderRadius: s.radius,
        fontSize: s.font,
        background: platform.badgeBg,
        color: platform.badgeColor,
        border: `1px solid ${platform.badgeBorder}`,
      }}
      aria-label={platform.name}
    >
      {platform.badge}
    </span>
  );
}
