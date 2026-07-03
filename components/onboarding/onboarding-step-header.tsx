/**
 * Shared step header for `/onboarding/workspace` and `/onboarding/plan`.
 *
 * Renders:
 *   1. A responsive numbered stepper: `● 1 — Workspace ——— 2 Plan`.
 *      - Complete steps render with a checkmark on filled ink.
 *      - The active step uses filled ink with the number in white.
 *      - Upcoming steps render outlined with muted number/label.
 *   2. Eyebrow "Step X of Y" (mono, uppercase).
 *   3. Title + subtitle, centered, with type that scales down on mobile.
 *
 * Server-only; no interactivity. Stateless — the parent supplies which step
 * is active so the layout doesn't need to introspect the URL.
 */

const STEPS = [
  { key: "workspace", label: "Workspace" },
  { key: "plan", label: "Plan" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

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
  const eyebrow = `Step ${activeIndex + 1} of ${STEPS.length}`;

  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      {/* Numbered stepper. Uses a fluid flex row so on mobile the connector
          line naturally shrinks. `aria-current` lands on the active step so
          assistive tech reads it correctly. */}
      <ol
        aria-label="Onboarding progress"
        className="mx-auto flex w-full max-w-md items-center gap-2 sm:gap-3"
      >
        {STEPS.map((s, i) => {
          const state: "complete" | "active" | "upcoming" =
            i < activeIndex ? "complete" : i === activeIndex ? "active" : "upcoming";
          return (
            <li key={s.key} className="flex flex-1 items-center gap-2 sm:gap-3">
              <StepBadge index={i + 1} state={state} />
              <span
                className={
                  "flex-1 truncate text-[12px] font-medium tracking-wide sm:text-[13px] " +
                  (state === "upcoming" ? "text-[#8B95A6]" : "text-[#1A2A4A]")
                }
                aria-current={state === "active" ? "step" : undefined}
              >
                {s.label}
              </span>
              {i < STEPS.length - 1 ? (
                <span
                  aria-hidden
                  className={
                    "h-px flex-1 " + (state === "complete" ? "bg-[#1A2A4A]" : "bg-[#1A2A4A]/15")
                  }
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* Title block — type scales up at sm; subtitle line-length capped
          for readability on wide viewports. */}
      <div className="text-center">
        <p
          className="text-[10.5px] font-medium tracking-[0.14em] text-[#5B6A85] uppercase"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {eyebrow}
        </p>
        <h1
          className="font-display mt-2 text-[26px] font-semibold tracking-tight sm:text-[32px]"
          style={{ letterSpacing: "-0.02em" }}
        >
          {title}
        </h1>
        <p className="mx-auto mt-3 max-w-[540px] text-[13.5px] leading-relaxed text-[#5B6A85] sm:text-[14.5px]">
          {subtitle}
        </p>
      </div>
    </div>
  );
}

function StepBadge({ index, state }: { index: number; state: "complete" | "active" | "upcoming" }) {
  if (state === "complete") {
    return (
      <span
        aria-hidden
        className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1A2A4A] text-white sm:h-7 sm:w-7"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden
        >
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
      <span
        aria-hidden
        className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1A2A4A] text-[11px] font-semibold text-white sm:h-7 sm:w-7 sm:text-[12px]"
      >
        {index}
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="flex h-6 w-6 items-center justify-center rounded-full border border-[#1A2A4A]/20 text-[11px] font-semibold text-[#8B95A6] sm:h-7 sm:w-7 sm:text-[12px]"
    >
      {index}
    </span>
  );
}
