"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestArtworkAction } from "@/app/(dashboard)/episodes/[id]/actions";

/**
 * Q1 feature #4 — button that fires the artwork pipeline. Styled to
 * match the "Clips" and "Download for client" affordances in the
 * episode-header action row.
 *
 * The button is always visible on live episodes; on click, we optimistically
 * show a "Generating…" state until router.refresh() picks up the row's
 * updated URLs. In practice the round-trip is ~15–30 s (three Workers AI
 * calls) so the caller usually navigates away and comes back.
 */
export function ArtworkTrigger({ episodeId }: { episodeId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await requestArtworkAction({ episodeId });
        if (!res.ok) setError(res.error);
        else router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={isPending}
        className="border-border text-ink hover:bg-canvas shadow-card flex items-center gap-2 rounded-[10px] border bg-white px-4 py-[10px] font-sans text-[13px] font-semibold transition-colors disabled:opacity-60"
        title="Generate hero artwork (Workers AI). Renders three aspect ratios."
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="2" y="2" width="10" height="10" rx="1.5" />
          <circle cx="5" cy="5.5" r="0.9" fill="currentColor" />
          <path d="M12 9L9 6.5 5 10.5" />
        </svg>
        {isPending ? "Requesting…" : "Artwork"}
      </button>
      {error && (
        <span className="text-danger text-[11.5px]" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
