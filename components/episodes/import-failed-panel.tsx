"use client";

import Link from "next/link";

/**
 * Phase 2.8 follow-up — error banner rendered on `/episodes/[id]` when
 * the pipeline tripped a non-retriable error (RSS guid no longer on
 * the feed, audio enclosure 404, transcribe 4xx, etc.). The pipeline's
 * `onFailure` handler persists `Episode.status = FAILED` +
 * `Episode.failureReason`; this component surfaces both.
 *
 * The CTA links back to the New Episode wizard so the user can pick a
 * different feed episode (or different source) without having to know
 * we don't yet have a per-episode retry-with-fresh-input flow.
 */
export function ImportFailedPanel({
  source,
  reason,
  showId,
  clientId,
}: {
  source: "PASTE" | "UPLOAD" | "RSS" | "YOUTUBE";
  reason: string | null;
  /** Pre-fills the wizard with the show this episode belonged to. */
  showId: string | null;
  /** Pre-fills the client filter on the wizard's first step. */
  clientId: string | null;
}) {
  const headline =
    source === "RSS"
      ? "RSS import failed"
      : source === "UPLOAD"
        ? "Transcription failed"
        : source === "YOUTUBE"
          ? "YouTube import failed"
          : "Generation failed";

  const params = new URLSearchParams();
  if (showId) params.set("showId", showId);
  if (clientId) params.set("clientId", clientId);
  const wizardHref = `/episodes/new${params.toString() ? `?${params.toString()}` : ""}`;

  return (
    <div
      className="mb-5 rounded-2xl p-[18px]"
      style={{ background: "#FBEDEC", border: "1px solid #F0CFC2" }}
    >
      <div className="flex items-start gap-[14px]">
        <span
          className="flex h-[36px] w-[36px] flex-shrink-0 items-center justify-center rounded-[10px]"
          style={{ background: "#F7DAD3" }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            stroke="#A03425"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 2L1 16h16L9 2z" />
            <path d="M9 7v4M9 13.2v.1" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[15px] font-semibold text-[#A03425]">{headline}</div>
          <p className="mt-[3px] text-[12.5px] text-[#7A3128]">
            {reason ??
              "The pipeline hit a non-retriable error and stopped. Try a different source or contact support if the issue persists."}
          </p>
        </div>
        <Link
          href={wizardHref}
          className="text-accent shrink-0 rounded-md border border-[#F0CFC2] bg-white px-[10px] py-[6px] font-sans text-[12px] font-semibold hover:bg-[#FBFCFE]"
        >
          {source === "RSS" ? "Pick a different episode" : "Start a new episode"}
        </Link>
      </div>
    </div>
  );
}
