"use client";

/**
 * Phase 2.8 — empty-state panel rendered on `/episodes/[id]` while an
 * RSS import (or any other source whose pipeline is still doing its
 * pre-generation work) is in flight. Mirrors `<TranscribingPanel>`'s
 * visual language so the two empty states feel like one family.
 *
 * Stateless — the page polls / receives SSE updates and re-renders this
 * panel away once outputs land or the episode flips to FAILED. The user
 * has nothing to retry at this stage; the import function will either
 * succeed, or its `onFailure` handler will flip the episode and trip
 * `<ImportFailedPanel>` instead.
 */
export function ImportingPanel({
  source,
}: {
  /** Drives the headline copy. */
  source: "RSS" | "YOUTUBE";
}) {
  const label = source === "RSS" ? "RSS feed" : "YouTube video";
  return (
    <div
      className="mb-5 rounded-2xl p-[18px]"
      style={{ background: "#F1FAF5", border: "1px solid #BFE3CD" }}
    >
      <div className="flex items-start gap-[14px]">
        <span
          className="flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-[10px]"
          style={{ background: "#E7F4EC" }}
        >
          <span
            className="inline-block h-[18px] w-[18px] rounded-full"
            style={{
              border: "2.5px solid #BFE3CD",
              borderTopColor: "#1E7A47",
              animation: "spin .9s linear infinite",
            }}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-ink text-[15px] font-semibold">
            Importing from {label}
          </div>
          <p className="text-muted mt-[3px] text-[12.5px]">
            We&apos;re pulling the publisher&apos;s transcript when available, or downloading the
            audio for transcription. The page will update automatically as the pipeline moves
            forward — usually a minute or two before outputs start landing.
          </p>
        </div>
      </div>
    </div>
  );
}
