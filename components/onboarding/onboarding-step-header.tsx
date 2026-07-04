/**
 * Shared step header for `/onboarding/workspace` and `/onboarding/plan` in
 * the revamp visual system (see `ref/UI/Revamp/`).
 *
 * Renders:
 *   1. Compact horizontal stepper with 24×24 pill badges and a 72px
 *      connector between steps. Complete steps use the bright blue accent
 *      (`#3A5BA0`) with a checkmark; the active step uses ink
 *      (`#0a1e3c`) with the numeric label; upcoming steps use a light
 *      outlined circle.
 *   2. Blue mono eyebrow "STEP X OF Y" (Spline Sans Mono, wide tracking).
 *   3. Big heading (40px / 800 weight) + tight subtitle.
 *
 * Layout is center-aligned; the stepper doesn't stretch across the column
 * (matching the ref). Server-only; no interactivity.
 */

const STEPS = [
  { key: "workspace", label: "Workspace" },
  { key: "plan", label: "Plan" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

const INK = "#0a1e3c";
const ACCENT = "#3A5BA0";
const MUTED = "#41506b";
const OUTLINE = "#d4dbe7";

export function OnboardingStepHeader({
  step,
  title,
  subtitle,
}: {
  step: StepKey;
  title: string;
  subtitle: string;
}) {
  const activeIndex = STEPS.findIndex((s) => s.key === step);
  const eyebrow = `STEP ${activeIndex + 1} OF ${STEPS.length}`;

  return (
    <div className="flex flex-col items-center">
      {/* Stepper — center-aligned, fluid but not full-width. */}
      <ol aria-label="Onboarding progress" className="flex items-center" style={{ gap: 14 }}>
        {STEPS.map((s, i) => {
          const state: "complete" | "active" | "upcoming" =
            i < activeIndex ? "complete" : i === activeIndex ? "active" : "upcoming";
          return (
            <li key={s.key} className="flex items-center" style={{ gap: 9 }}>
              <StepBadge index={i + 1} state={state} />
              <span
                aria-current={state === "active" ? "step" : undefined}
                style={{
                  fontSize: 13.5,
                  fontWeight: state === "active" ? 700 : state === "complete" ? 600 : 500,
                  color: state === "upcoming" ? "#8a97ad" : state === "active" ? INK : MUTED,
                }}
              >
                {s.label}
              </span>
              {i < STEPS.length - 1 ? (
                <span
                  aria-hidden
                  style={{
                    width: 72,
                    height: 2,
                    marginLeft: 5,
                    borderRadius: 2,
                    background: state === "complete" ? ACCENT : "#e4e9f1",
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* Title block */}
      <div className="text-center" style={{ marginTop: 36 }}>
        <p
          style={{
            fontFamily: "var(--font-revamp-mono)",
            fontSize: 11,
            letterSpacing: "0.16em",
            color: ACCENT,
            fontWeight: 600,
            margin: 0,
          }}
        >
          {eyebrow}
        </p>
        <h1
          style={{
            fontFamily: "var(--font-revamp-sans)",
            fontSize: 40,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            marginTop: 12,
            marginBottom: 0,
            color: INK,
            lineHeight: 1.1,
          }}
        >
          {title}
        </h1>
        <p
          style={{
            fontSize: 15,
            color: MUTED,
            marginTop: 10,
            maxWidth: 560,
            marginLeft: "auto",
            marginRight: "auto",
            lineHeight: 1.55,
          }}
        >
          {subtitle}
        </p>
      </div>
    </div>
  );
}

function StepBadge({ index, state }: { index: number; state: "complete" | "active" | "upcoming" }) {
  const base = {
    width: 24,
    height: 24,
    borderRadius: 99,
    display: "grid" as const,
    placeItems: "center" as const,
    fontSize: 12,
    color: "#fff",
  };
  if (state === "complete") {
    return (
      <span aria-hidden style={{ ...base, background: ACCENT }}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M2.5 6.2l2.4 2.4L9.5 4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (state === "active") {
    return (
      <span aria-hidden style={{ ...base, background: INK, fontWeight: 700 }}>
        {index}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      style={{
        ...base,
        background: "#fff",
        color: "#8a97ad",
        border: `1px solid ${OUTLINE}`,
        fontWeight: 600,
      }}
    >
      {index}
    </span>
  );
}
