"use client";

import { useState } from "react";
import type { KeyMoment } from "@/server/ai/key-moments";

/**
 * "Clip moments" panel rendered on `/episodes/[id]` between the progress
 * strip and the outputs grid. Each card surfaces a standout moment the
 * pipeline extracted during generation (`extractKeyMoments`) so writers
 * can grab the timestamp + the canonical quote without scrubbing through
 * the transcript.
 *
 * Returns null when there's nothing to show — most natural empty state
 * (a brand-new episode that hasn't been generated yet would have null
 * `keyMoments`).
 */
export function ClipMomentsPanel({ moments }: { moments?: KeyMoment[] | null }) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  if (!moments || moments.length === 0) return null;

  const onCopy = (idx: number, text: string) => {
    try {
      navigator.clipboard?.writeText(text);
    } catch {
      /* ignore */
    }
    setCopiedIdx(idx);
    window.setTimeout(() => {
      setCopiedIdx((current) => (current === idx ? null : current));
    }, 1300);
  };

  return (
    <section
      className="border-border bg-surface mb-5 rounded-2xl border p-4"
      aria-label="Clip moments"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <div className="font-display text-ink text-[14px] font-semibold">Clip moments</div>
          <div className="text-muted-2 mt-[2px] text-[12px]">
            Standout beats the engine pulled from the transcript — copy a quote to start a clip.
          </div>
        </div>
        <span className="text-muted-2 font-sans text-[11.5px] font-medium">
          {moments.length} moment{moments.length === 1 ? "" : "s"}
        </span>
      </div>

      <div
        className="grid gap-[12px]"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}
      >
        {moments.map((m, i) => (
          <article
            key={`${m.topic}-${i}`}
            className="border-border-subtle bg-surface-2 flex flex-col gap-[8px] rounded-xl border p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="font-display text-ink text-[13px] leading-tight font-semibold">
                {m.topic}
              </div>
              {m.timestamp && (
                <span
                  className="rounded-pill bg-canvas text-muted flex-shrink-0 px-[8px] py-[2px] font-sans text-[10.5px] font-semibold tracking-[0.04em]"
                  style={{ border: "1px solid #E6EBF3" }}
                >
                  {m.timestamp}
                </span>
              )}
            </div>

            <blockquote
              className="border-l-[2px] pl-[10px] font-sans text-[12.5px] leading-[1.55] text-[#39435A] italic"
              style={{ borderColor: "var(--color-accent-border)" }}
            >
              &ldquo;{m.quote}&rdquo;
            </blockquote>

            {m.insight && <p className="text-muted text-[11.5px] leading-[1.45]">{m.insight}</p>}

            <button
              type="button"
              onClick={() => onCopy(i, m.quote)}
              className="mt-1 inline-flex w-fit items-center gap-[6px] rounded-md px-2 py-[5px] font-sans text-[11.5px] font-semibold transition-colors"
              style={{
                background: copiedIdx === i ? "#E7F4EC" : "var(--color-accent-soft)",
                color: copiedIdx === i ? "#1E7A47" : "var(--color-accent)",
                border: `1px solid ${copiedIdx === i ? "#BFE3CD" : "var(--color-accent-border)"}`,
              }}
            >
              {copiedIdx === i ? (
                <>
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 11 11"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2 5.5l2.4 2.4L9 3.5" />
                  </svg>
                  Quote copied
                </>
              ) : (
                <>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <rect x="4.5" y="4.5" width="7.5" height="7.5" rx="1.6" />
                    <path d="M9.5 4.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v5A1.5 1.5 0 0 0 3 9.5h1.5" />
                  </svg>
                  Copy quote
                </>
              )}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
