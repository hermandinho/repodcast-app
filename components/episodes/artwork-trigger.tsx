"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestArtworkAction } from "@/app/(dashboard)/episodes/[id]/actions";

/**
 * Q1 feature #4 — button that fires the artwork pipeline.
 *
 * The action is fire-and-forget on the server (it enqueues an Inngest
 * event and returns immediately). The real work — three Workers AI
 * calls + R2 uploads — takes ~15–30 s. We need to poll for the DB write
 * so the tab shows the fresh artwork without a manual reload.
 *
 * `artworkSignature` uniquely identifies the current render. The R2
 * keys in `generate-artwork.ts` include `Date.now()`, so passing
 * `heroImageUrl ?? "empty"` in gives us a value that changes whenever
 * a render lands. When the signature we captured on click differs from
 * the incoming prop, polling exits.
 */
export function ArtworkTrigger({
  episodeId,
  hasArtwork,
  artworkSignature,
}: {
  episodeId: string;
  hasArtwork: boolean;
  /** URL of one of the artwork variants (or null when none). Used as
   *  a change-detector to end the polling window. */
  artworkSignature: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [awaitingSince, setAwaitingSince] = useState<number | null>(null);
  const signatureAtRequestRef = useRef<string | null>(null);

  // Exit the polling window when a new signature arrives (render
  // landed) or after 60 s hard-timeout (fallback for silent failures).
  useEffect(() => {
    if (awaitingSince === null) return;
    if (artworkSignature !== signatureAtRequestRef.current) {
      setAwaitingSince(null);
      return;
    }
    const t = setTimeout(() => setAwaitingSince(null), 60_000);
    return () => clearTimeout(t);
  }, [awaitingSince, artworkSignature]);

  // Poll while awaiting. 3 s cadence matches the clips tab's polling —
  // fast enough that the UI feels responsive, slow enough that we
  // don't hammer the DB.
  useEffect(() => {
    if (awaitingSince === null) return;
    const t = setInterval(() => router.refresh(), 3_000);
    return () => clearInterval(t);
  }, [awaitingSince, router]);

  const preparing = awaitingSince !== null;
  const label = preparing
    ? "Generating…"
    : isPending
      ? "Requesting…"
      : hasArtwork
        ? "Regenerate artwork"
        : "Generate artwork";
  const title = hasArtwork
    ? "Regenerate all three aspect ratios. Counts against your monthly artwork budget."
    : "Generate hero artwork. First render is free — renders three aspect ratios.";

  const onClick = () => {
    setError(null);
    // Capture the signature BEFORE firing so the effect can compare
    // against the "before" state. If we captured after, a fast landing
    // could equal the value we captured and we'd never exit polling.
    signatureAtRequestRef.current = artworkSignature;
    startTransition(async () => {
      try {
        const res = await requestArtworkAction({ episodeId });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setAwaitingSince(Date.now());
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={isPending || preparing}
        className="border-border text-ink hover:bg-canvas shadow-card flex items-center gap-2 rounded-[10px] border bg-white px-4 py-[10px] font-sans text-[13px] font-semibold transition-colors disabled:opacity-60"
        title={title}
      >
        {preparing ? <Spinner /> : <ArtworkIcon />}
        {label}
      </button>
      {preparing && (
        <span className="text-muted-2 text-[11.5px]">
          Rendering three aspect ratios · takes about 30 seconds
        </span>
      )}
      {error && (
        <span className="text-danger text-[11.5px]" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function ArtworkIcon() {
  return (
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
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="border-muted/30 border-t-accent inline-block h-[14px] w-[14px] animate-spin rounded-full border-[1.6px]"
    />
  );
}
