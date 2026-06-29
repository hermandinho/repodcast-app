"use client";

import { useState } from "react";

type Client = {
  show: string;
  initials: string;
  label: "Strong" | "Developing" | "Weak";
  pct: number;
  trained: number;
  avatar: string;
  sample: string;
  traits: string[];
};

const CLIENTS: Client[] = [
  {
    show: "The Founder's Cut",
    initials: "FC",
    label: "Strong",
    pct: 92,
    trained: 38,
    avatar: "#2A3F6B",
    sample:
      "Most founders don't have a growth problem. They have a focus problem. On this week's episode we got into why saying no to a great opportunity is the highest-leverage thing you'll do all quarter — and why it never gets easier. Full breakdown in the comments.",
    traits: [
      "Short, declarative opener",
      "Drops one contrarian take early",
      "Ends with a soft CTA, never salesy",
    ],
  },
  {
    show: "Mid-Run Mornings",
    initials: "MM",
    label: "Developing",
    pct: 64,
    trained: 11,
    avatar: "#3A5BA0",
    sample:
      "Here's your gentle reminder that rest is part of the training plan, not a break from it. This week we talked about the mornings you don't feel like showing up — and the tiny, kind systems that get you out the door anyway. No pressure. Just one small step.",
    traits: ["Warm, second-person voice", "Leads with reassurance", "Avoids hustle language"],
  },
  {
    show: "Tape & Tonic",
    initials: "TT",
    label: "Strong",
    pct: 88,
    trained: 29,
    avatar: "#1F3358",
    sample:
      "We sat down with a sound designer who's scored films you've definitely cried to, and asked the only question that matters: how do you make silence feel loud? It got nerdy. It got a little emotional. We have no notes. New episode out now.",
    traits: [
      "Witty, culture-forward hook",
      "Conversational asides",
      "Confident, never explains the joke",
    ],
  },
];

export function ClientPicker() {
  const [active, setActive] = useState(0);
  const vc = CLIENTS[active];
  const labelColor =
    vc.label === "Strong" ? "#7FE3B0" : vc.label === "Developing" ? "#E0B45B" : "#E07F7F";

  return (
    <div
      className="grid overflow-hidden rounded-2xl"
      style={{
        background: "#13203B",
        border: "1px solid #2A3C60",
        gridTemplateColumns: "288px 1fr",
      }}
    >
      {/* Client list */}
      <div className="p-[14px]" style={{ borderRight: "1px solid #2A3C60" }}>
        <div
          className="px-[10px] pt-2 pb-[14px] text-[11px] font-medium tracking-[0.08em] uppercase"
          style={{ color: "#6B7BA3", fontFamily: "var(--font-mono)" }}
        >
          Your clients
        </div>
        <div className="flex flex-col gap-1">
          {CLIENTS.map((c, i) => {
            const isActive = active === i;
            const rowLabelColor =
              c.label === "Strong" ? "#7FE3B0" : c.label === "Developing" ? "#E0B45B" : "#E07F7F";
            return (
              <button
                key={c.show}
                type="button"
                onClick={() => setActive(i)}
                className="flex cursor-pointer items-center gap-[11px] rounded-[10px] px-3 py-[13px] text-left transition-colors"
                style={{
                  background: isActive ? "#1E3056" : "transparent",
                  border: "none",
                }}
              >
                <span
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[9px] font-semibold"
                  style={{
                    background: c.avatar,
                    color: "#FFFFFF",
                    fontFamily: "var(--font-display)",
                    fontSize: "13px",
                  }}
                >
                  {c.initials}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="truncate text-[14px] font-medium" style={{ color: "#FFFFFF" }}>
                    {c.show}
                  </span>
                  <span className="flex items-center gap-[6px]">
                    <span
                      className="text-[11px]"
                      style={{ color: rowLabelColor, fontFamily: "var(--font-mono)" }}
                    >
                      {c.label}
                    </span>
                    <span
                      className="text-[11px]"
                      style={{ color: "#6B7BA3", fontFamily: "var(--font-mono)" }}
                    >
                      {c.pct}%
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active client panel */}
      <div className="grid" style={{ background: "#FFFFFF", gridTemplateColumns: "1.12fr 0.88fr" }}>
        <div className="px-[30px] pt-[30px] pb-7" style={{ borderRight: "1px solid #EEF0F5" }}>
          <div className="mb-[18px] flex items-center gap-[9px]">
            <svg width="20" height="20" viewBox="0 0 20 20">
              <rect width="20" height="20" rx="5" fill="#0A66C2" />
              <text
                x="10"
                y="14"
                fontFamily="Inter,sans-serif"
                fontSize="10"
                fontWeight="700"
                fill="#fff"
                textAnchor="middle"
              >
                in
              </text>
            </svg>
            <span className="text-[13.5px] font-medium" style={{ color: "#5A6473" }}>
              LinkedIn · in{" "}
              <span className="font-semibold" style={{ color: "#1A2A4A" }}>
                {vc.show}
              </span>
              &apos;s voice
            </span>
          </div>
          <div
            className="rounded-xl p-[22px] text-[15.5px] leading-[1.62]"
            style={{
              border: "1px solid #EEF0F5",
              color: "#2A3445",
              minHeight: "196px",
            }}
          >
            {vc.sample}
          </div>
          <div className="mt-4 flex gap-[9px]">
            <span
              className="rounded-lg px-4 py-[9px] text-[13px] font-semibold"
              style={{ background: "#EAF7F0", color: "#1F8A5B" }}
            >
              Approve
            </span>
            <span
              className="rounded-lg px-4 py-[9px] text-[13px] font-medium"
              style={{ background: "#F4F6FA", color: "#5A6473" }}
            >
              Tweak
            </span>
          </div>
        </div>

        <div className="px-[30px] pt-[30px] pb-7">
          <div
            className="mb-[10px] text-[11px] font-medium tracking-[0.06em] uppercase"
            style={{ color: "#9AA3B2", fontFamily: "var(--font-mono)" }}
          >
            Voice strength
          </div>
          <div
            className="text-[28px] font-bold"
            style={{
              color: "#1A2A4A",
              fontFamily: "var(--font-display)",
              letterSpacing: "-0.02em",
            }}
          >
            {vc.label}
          </div>
          <div className="my-4 h-2 overflow-hidden rounded-[5px]" style={{ background: "#EEF0F5" }}>
            <div
              className="h-full rounded-[5px] transition-[width] duration-500"
              style={{ background: "#3A5BA0", width: `${vc.pct}%` }}
            />
          </div>
          <div
            className="flex justify-between text-[10.5px]"
            style={{ color: "#A6AEBC", fontFamily: "var(--font-mono)" }}
          >
            <span>Weak</span>
            <span>Developing</span>
            <span>Strong</span>
          </div>
          <div className="my-4 text-[13px] leading-[1.5]" style={{ color: "#5A6473" }}>
            <span className="font-semibold" style={{ color: "#1A2A4A" }}>
              {vc.trained}
            </span>{" "}
            approved posts trained this voice.
          </div>
          <div
            className="mb-[13px] text-[11px] font-medium tracking-[0.06em] uppercase"
            style={{ color: "#9AA3B2", fontFamily: "var(--font-mono)" }}
          >
            Learned traits
          </div>
          <div className="flex flex-col gap-[11px]">
            {vc.traits.map((t, i) => (
              <div
                key={i}
                className="flex items-start gap-[10px] text-[13.5px] leading-[1.4]"
                style={{ color: "#2A3445" }}
              >
                <span
                  className="mt-[6px] flex-shrink-0 rounded-full"
                  style={{ width: 5, height: 5, background: labelColor }}
                />
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
