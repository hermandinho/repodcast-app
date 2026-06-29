import type { HTMLAttributes } from "react";

type Tone = "default" | "accent";

const TONE_CLASSES: Record<Tone, string> = {
  default: "border border-border bg-surface",
  // Accent-tinted variant used by the hero KPI tile and the AI summary callout.
  accent: "border border-accent-border bg-accent-soft",
};

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  tone?: Tone;
  /**
   * `rounded` controls the outer corner radius. Most surfaces in the app use
   * 2xl (14px); the larger panels (Voice page sections, episode header
   * band) use 3xl (16px).
   */
  rounded?: "2xl" | "3xl";
  /** Whether to apply the soft default shadow. Pages without a visible card
   * border (e.g. the activity rail panels) opt out. */
  shadow?: boolean;
};

export function Card({
  tone = "default",
  rounded = "2xl",
  shadow = true,
  className,
  children,
  ...rest
}: CardProps) {
  const cls = [
    rounded === "3xl" ? "rounded-3xl" : "rounded-2xl",
    TONE_CLASSES[tone],
    shadow ? "shadow-card" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
