"use client";

export type PipelineStep = "import" | "transcribe" | "generate";

export type PipelineStepState = "done" | "active" | "pending" | "failed";

type StepDef = {
  key: PipelineStep;
  label: string;
};

const ALL_STEPS: Record<PipelineStep, StepDef> = {
  import: { key: "import", label: "Import" },
  transcribe: { key: "transcribe", label: "Transcribe" },
  generate: { key: "generate", label: "Generate outputs" },
};

const SOURCE_STEPS: Record<"RSS" | "YOUTUBE" | "UPLOAD" | "PASTE", PipelineStep[]> = {
  RSS: ["import", "transcribe", "generate"],
  // YouTube can end after import (captions win) or continue through
  // transcribe (audio fallback via Deepgram). We show the full three-step
  // path so users see both possibilities upfront — the middle step gets
  // marked "done" instantly on the transcript-first exit.
  YOUTUBE: ["import", "transcribe", "generate"],
  UPLOAD: ["transcribe", "generate"],
  PASTE: ["generate"],
};

const TONE = {
  done: { dot: "#1E7A47", ring: "#BFE3CD", label: "#1E7A47" },
  active: { dot: "#3A5BA0", ring: "#DCE3F0", label: "#3A5BA0" },
  pending: { dot: "#C3CBD8", ring: "#E6EBF3", label: "#8A93A6" },
  failed: { dot: "#C0392B", ring: "#F0CCC9", label: "#C0392B" },
};

export function PipelineStepper({
  source,
  activeStep,
  failedStep = null,
}: {
  source: "RSS" | "YOUTUBE" | "UPLOAD" | "PASTE";
  /** The step currently in flight. Prior steps auto-render as "done". */
  activeStep: PipelineStep;
  /** When set, `failedStep` renders as failed and later steps stay pending. */
  failedStep?: PipelineStep | null;
}) {
  const steps = SOURCE_STEPS[source].map((k) => ALL_STEPS[k]);
  const activeIdx = steps.findIndex((s) => s.key === activeStep);
  const failedIdx = failedStep ? steps.findIndex((s) => s.key === failedStep) : -1;

  return (
    <ol className="flex items-center gap-[6px]">
      {steps.map((step, i) => {
        let state: PipelineStepState;
        if (failedIdx !== -1) {
          if (i < failedIdx) state = "done";
          else if (i === failedIdx) state = "failed";
          else state = "pending";
        } else if (i < activeIdx) {
          state = "done";
        } else if (i === activeIdx) {
          state = "active";
        } else {
          state = "pending";
        }
        const tone = TONE[state];
        const isLast = i === steps.length - 1;
        return (
          <li key={step.key} className="flex flex-1 items-center gap-[6px]">
            <span
              className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full"
              style={{ background: "#fff", border: `1.5px solid ${tone.ring}` }}
              aria-hidden
            >
              {state === "done" ? (
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke={tone.dot}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M2.5 6.2 5 8.5 9.5 3.5" />
                </svg>
              ) : state === "active" ? (
                <span
                  className="inline-block h-[10px] w-[10px] rounded-full"
                  style={{
                    border: `2px solid ${tone.ring}`,
                    borderTopColor: tone.dot,
                    animation: "spin .8s linear infinite",
                  }}
                />
              ) : state === "failed" ? (
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke={tone.dot}
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M3 3 9 9M9 3 3 9" />
                </svg>
              ) : (
                <span
                  className="inline-block h-[6px] w-[6px] rounded-full"
                  style={{ background: tone.dot }}
                />
              )}
            </span>
            <span
              className="font-sans text-[12px] font-semibold whitespace-nowrap"
              style={{ color: tone.label }}
            >
              {step.label}
            </span>
            {!isLast && (
              <span
                className="h-[1.5px] flex-1 rounded-full"
                style={{
                  background:
                    state === "done" ? "#BFE3CD" : state === "failed" ? "#F0CCC9" : "#E6EBF3",
                }}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
