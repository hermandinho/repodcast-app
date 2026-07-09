"use client";

import { LeaveAndNotifyHint } from "./leave-and-notify-hint";
import { PipelineStepper } from "./pipeline-stepper";

/**
 * Empty-state panel rendered on `/episodes/[id]` after transcript is in
 * hand but before the first GeneratedOutput row lands. `generate-episode`
 * fires N parallel Claude calls and only persists rows once every call
 * settles, so there's a ~15-45s window where the outputs grid is empty
 * and the user has nothing to look at. Prior to this panel the page fell
 * through the empty-state cascade to `null` — the "empty page" bug the
 * PASTE flow was showing, and the "steps stopped working" gap between
 * TranscribingPanel disappearing and outputs appearing on UPLOAD.
 *
 * Stateless — SSE (or a hard nav) swaps this panel out once the grid
 * populates. Same visual language as <TranscribingPanel> + <ImportingPanel>
 * so the pipeline reads as one continuous progression.
 */
export function GeneratingPanel({ source }: { source: "PASTE" | "UPLOAD" | "RSS" | "YOUTUBE" }) {
  return (
    <div
      className="mb-5 rounded-2xl p-[16px]"
      style={{ background: "#F7FBF9", border: "1px solid #DBEBE1" }}
    >
      <div className="mb-[14px] flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-display text-ink text-[14.5px] font-semibold">
            Writing your outputs
          </div>
          <p className="text-muted-2 mt-[3px] text-[12px] leading-[1.55]">
            One draft per platform, in your show&apos;s voice. Each tile pops in as soon as its
            draft is ready — usually under a minute in total.
          </p>
        </div>
        <span className="text-muted-2 font-sans text-[11.5px] whitespace-nowrap">~20–45 sec</span>
      </div>
      <PipelineStepper source={source} activeStep="generate" />
      <LeaveAndNotifyHint />
    </div>
  );
}
