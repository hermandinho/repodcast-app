"use client";

import { LeaveAndNotifyHint } from "./leave-and-notify-hint";
import { PipelineStepper } from "./pipeline-stepper";

/**
 * Empty-state panel rendered on `/episodes/[id]` while an RSS / YouTube
 * import is in flight. Shares its visual language with
 * <TranscribingPanel> and <ImportFailedPanel> via <PipelineStepper> so
 * the pre-generation states feel like one connected pipeline instead of
 * three disconnected notices.
 *
 * Stateless — the page polls / receives SSE updates and re-renders this
 * panel away once outputs land or the episode flips to FAILED. The user
 * has nothing to retry at this stage; the import function will either
 * succeed, or its `onFailure` handler will flip the episode and trip
 * <ImportFailedPanel> instead.
 */
export function ImportingPanel({ source }: { source: "RSS" | "YOUTUBE" }) {
  const label = source === "RSS" ? "RSS feed" : "YouTube video";
  return (
    <div
      className="mb-5 rounded-2xl p-[16px]"
      style={{ background: "#F7FBF9", border: "1px solid #DBEBE1" }}
    >
      <div className="mb-[14px] flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-display text-ink text-[14.5px] font-semibold">
            Importing from {label}
          </div>
          <p className="text-muted-2 mt-[3px] text-[12px] leading-[1.55]">
            Pulling the publisher&apos;s transcript when available, or downloading audio for
            transcription. The page updates automatically as the pipeline advances.
          </p>
        </div>
        <span className="text-muted-2 font-sans text-[11.5px] whitespace-nowrap">
          Usually 1–2 min
        </span>
      </div>
      <PipelineStepper source={source} activeStep="import" />
      <LeaveAndNotifyHint />
    </div>
  );
}
