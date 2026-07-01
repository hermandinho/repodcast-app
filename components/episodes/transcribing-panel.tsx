"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  retranscribeEpisodeAction,
  updateEpisodeTranscriptAction,
} from "@/app/(dashboard)/episodes/[id]/actions";
import { PipelineStepper } from "./pipeline-stepper";

/**
 * Phase 2.7 — empty-state UX on `/episodes/[id]` while an UPLOAD episode
 * is mid-transcription. Renders three primary affordances:
 *
 *   1. A friendly "Transcribing..." message + spinner so the page doesn't
 *      look broken during the Deepgram round-trip.
 *   2. A "Try again" button that re-fires `episode/transcribe.requested`
 *      via `retranscribeEpisodeAction` — useful when transcription failed
 *      or the event got lost.
 *   3. A "Paste a transcript" toggle that opens an inline textarea + Save
 *      button. Saving writes the transcript and (if the episode was still
 *      awaiting one) kicks the generation pipeline. Handy when Deepgram
 *      hands back garbage on a poor-quality recording.
 *
 * Self-contained: the page only passes the episode id; the actions are
 * imported directly and refresh the route on success so the panel
 * disappears once the transcript lands.
 */
export function TranscribingPanel({ episodeId }: { episodeId: string }) {
  const router = useRouter();
  const [retranscribing, startRetranscribe] = useTransition();
  const [saving, startSave] = useTransition();
  const [showEditor, setShowEditor] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onRetry = () => {
    setError(null);
    startRetranscribe(async () => {
      try {
        const result = await retranscribeEpisodeAction({ episodeId });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // No router.refresh — the event is async; the page will pick up
        // the new transcript via the SSE stream or the next nav.
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't retry transcribe.");
      }
    });
  };

  const onSave = () => {
    setError(null);
    if (draft.trim().length === 0) {
      setError("Paste a transcript before saving.");
      return;
    }
    startSave(async () => {
      try {
        const result = await updateEpisodeTranscriptAction({
          episodeId,
          transcript: draft,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // Generation pipeline now running. The router.refresh swaps the
        // page over to the populated outputs view as soon as the first
        // GENERATING placeholders land.
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save transcript.");
      }
    });
  };

  return (
    <div
      className="mb-5 rounded-2xl p-[16px]"
      style={{ background: "#F7FBF9", border: "1px solid #DBEBE1" }}
    >
      <div className="mb-[14px] flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-display text-ink text-[14.5px] font-semibold">
            Transcribing your audio
          </div>
          <p className="text-muted-2 mt-[3px] text-[12px] leading-[1.55]">
            Deepgram is working through the recording — typically 30–90 seconds for a one-hour
            episode. Generation starts as soon as the transcript lands.
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-[7px]">
          <button
            type="button"
            onClick={onRetry}
            disabled={retranscribing || saving}
            className="text-muted-2 hover:text-ink rounded-md px-[10px] py-[6px] font-sans text-[12px] font-medium transition-colors hover:bg-white disabled:opacity-50"
          >
            {retranscribing ? "Retrying…" : "Try again"}
          </button>
          <button
            type="button"
            onClick={() => setShowEditor((v) => !v)}
            disabled={saving}
            className="border-accent-border bg-accent-soft text-accent rounded-md border px-[10px] py-[6px] font-sans text-[12px] font-semibold transition-colors hover:bg-white disabled:opacity-50"
          >
            {showEditor ? "Cancel" : "Paste a transcript"}
          </button>
        </div>
      </div>

      <PipelineStepper source="UPLOAD" activeStep="transcribe" />

      {showEditor && (
        <div className="mt-[14px]">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Paste the full episode transcript here. Saving kicks generation immediately."
            className="h-[200px] w-full resize-y rounded-xl px-[14px] py-[12px] font-sans text-[13px] leading-[1.6] text-[#2A3550] outline-none placeholder:text-[#A6AEBD]"
            style={{ border: "1px solid #C9D4E8", background: "#FFFFFF" }}
          />
          <div className="mt-[10px] flex items-center justify-between gap-3">
            <div className="text-muted-2 text-[12px]">
              {draft.trim().length === 0
                ? "Empty"
                : `${draft.trim().split(/\s+/).filter(Boolean).length} words`}
            </div>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || draft.trim().length === 0}
              className="bg-accent rounded-[10px] px-3 py-[8px] font-sans text-[12.5px] font-semibold text-white transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ border: "1px solid rgba(0,0,0,.06)" }}
            >
              {saving ? "Saving…" : "Save transcript & generate"}
            </button>
          </div>
        </div>
      )}

      {error && <div className="mt-[10px] text-[12px] text-[#A06D12]">{error}</div>}
    </div>
  );
}
