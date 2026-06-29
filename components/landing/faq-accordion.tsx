"use client";

import { useState } from "react";

const FAQS = [
  {
    q: "How does the voice learning actually work?",
    a: "Each client gets their own voice model. It starts from a sample of their existing posts and transcripts, then refines every time you approve a generated post. Approvals teach it what's right; edits teach it what to fix. Strength moves Weak → Developing → Strong as confidence grows — usually Strong within three or four episodes.",
  },
  {
    q: "Is the white-label real white-label?",
    a: "Yes. On Agency and Network plans you can put your own studio's brand on the dashboard, exports, and client-facing approval links. Your clients never see Repodcast — it looks like a tool you built in-house.",
  },
  {
    q: "What can I feed it as a transcript?",
    a: "Paste raw text, upload an audio file, connect a podcast RSS feed, or drop a YouTube link. We transcribe audio and video automatically, so you can point it at wherever the episode already lives.",
  },
  {
    q: "Are the outputs actually ready to post?",
    a: "They're built to be post-ready — correct format, length, and tone for each platform, in your client's voice. Most studios review and ship same-day. The approval workflow lets you queue, tweak, and sign off in one pass.",
  },
  {
    q: "Does each client's voice stay separate?",
    a: "Completely. Voice models are walled off per client — one show's cadence never bleeds into another's. Add or remove clients anytime without affecting the others.",
  },
  {
    q: "What happens if I outgrow my plan?",
    a: "Upgrade in one click and your existing voice models, history, and approvals carry over untouched. Show counts are soft-capped — we'll flag you before anything stops, never after.",
  },
];

export function FAQAccordion() {
  const [openIndex, setOpenIndex] = useState<number>(0);

  return (
    <div style={{ borderTop: "1px solid #E8EBF1" }}>
      {FAQS.map((f, i) => {
        const open = openIndex === i;
        return (
          <div key={i} style={{ borderBottom: "1px solid #E8EBF1" }}>
            <button
              type="button"
              onClick={() => setOpenIndex(open ? -1 : i)}
              className="flex w-full cursor-pointer items-center justify-between gap-4 py-[22px] text-left"
              style={{ background: "transparent", border: "none", fontFamily: "var(--font-sans)" }}
            >
              <span
                className="text-[16px] font-semibold"
                style={{ color: "#1A2A4A", letterSpacing: "-0.01em" }}
              >
                {f.q}
              </span>
              <span
                className="flex-shrink-0 text-[20px] font-light transition-transform duration-200"
                style={{
                  color: "#9AA3B2",
                  transform: open ? "rotate(45deg)" : "rotate(0deg)",
                }}
              >
                +
              </span>
            </button>
            {open && (
              <div
                className="max-w-[90%] pb-6 text-[15px] leading-[1.66]"
                style={{ color: "#5A6473" }}
              >
                {f.a}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
