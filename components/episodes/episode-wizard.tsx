"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Platform } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { VoiceStrengthBars } from "@/components/ui/voice-strength-bars";
import { PlanLimitBanner, type PlanLimitCapacity } from "@/components/billing/plan-limit-banner";
import { sampleShows, type SampleShow } from "@/lib/sample-data/shows";
import { platforms, type PlatformKey } from "@/lib/sample-data/platforms";
import { voiceBg, voiceLabel, voiceTextColor } from "@/lib/sample-data/voice-strength";
import { createEpisodeAction } from "@/app/(dashboard)/episodes/new/actions";

type Method = "paste" | "upload" | "rss" | "youtube";

type MethodMeta = {
  key: Method;
  name: string;
  desc: string;
  /** Border + accent color when selected. */
  accent: string;
  /** Icon avatar background. */
  iconBg: string;
  /** Soft tint background when selected. */
  tint: string;
  icon: ReactNode;
};

const methodIcon = (key: Method): ReactNode => {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 18 18",
    fill: "none",
    stroke: "#fff",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (key) {
    case "paste":
      return (
        <svg {...common}>
          <rect x="3.5" y="2.5" width="11" height="13" rx="1.8" />
          <path d="M6 6h6M6 9h6M6 12h4" />
        </svg>
      );
    case "upload":
      return (
        <svg {...common}>
          <path d="M9 12V3M6 5.5L9 2.5l3 3" />
          <path d="M3.5 11.5v2A1.5 1.5 0 0 0 5 15h8a1.5 1.5 0 0 0 1.5-1.5v-2" />
        </svg>
      );
    case "rss":
      return (
        <svg {...common}>
          <path d="M4 13.5a1 1 0 1 0 0-.01" />
          <path d="M4 9.5a4 4 0 0 1 4 4M4 5.5a8 8 0 0 1 8 8" />
        </svg>
      );
    case "youtube":
      return (
        <svg {...common}>
          <rect x="2.5" y="4.5" width="13" height="9" rx="2.2" />
          <path d="M7.5 7.2l3.2 1.8-3.2 1.8z" fill="#fff" stroke="none" />
        </svg>
      );
  }
};

const methods: MethodMeta[] = [
  {
    key: "paste",
    name: "Paste transcript",
    desc: "Already have the text? Drop it straight in.",
    accent: "#3A5BA0",
    iconBg: "#3A5BA0",
    tint: "#EEF2FB",
    icon: methodIcon("paste"),
  },
  {
    key: "upload",
    name: "Upload audio",
    desc: "MP3, WAV or M4A — we transcribe it for you.",
    accent: "#1E7A47",
    iconBg: "#2E9E5B",
    tint: "#E7F4EC",
    icon: methodIcon("upload"),
  },
  {
    key: "rss",
    name: "Import from RSS",
    desc: "Connect a feed and pull the latest episode.",
    accent: "#A06D12",
    iconBg: "#C9952B",
    tint: "#FBF1DE",
    icon: methodIcon("rss"),
  },
  {
    key: "youtube",
    name: "YouTube URL",
    desc: "Paste a link — we grab captions and audio.",
    accent: "#C0392B",
    iconBg: "#D64545",
    tint: "#FBEDEC",
    icon: methodIcon("youtube"),
  },
];

/**
 * Demo transcript surfaced behind the "Use a sample transcript" button on
 * the paste step. Sized > 500 words so it passes the server's transcript-
 * length validator (`createEpisodeInput.transcript.min(500)`) and the
 * Inngest pipeline's word-count guard. Keep it narratively continuous so
 * the generated outputs read like a real conversation.
 */
const SAMPLE_TRANSCRIPT = `Maya Chen: Welcome back to The Founder's Frequency. I'm here with Dani Okafor, who scaled her last company from four people to four hundred. Dani, thanks for coming on.

Dani Okafor: Thanks for having me, Maya. This is a fun one.

Maya: So I want to start somewhere specific. Most founders obsess over hire one hundred. You say the one that actually matters is hire number four. Why?

Dani: Because your first ten hires don't fill roles — they write your culture's source code. Everything after them compiles against what those ten people decided was normal. Hires one through three set the bar, and hire four is usually the first person who joins because of the bar, not in spite of it.

Maya: Say more about "source code."

Dani: When you're four people, every decision is a conversation. At forty, it's a pattern. At four hundred, it's a system you can't see anymore. The patterns you set early are the ones that scale — the good ones and the blind spots. You can fix a bug in a process. You can't really fix a habit that's been compounding for three years across two hundred people.

Maya: How did you screen for that early on?

Dani: I stopped asking about experience and started asking about slope. Where someone is going beats where they are today. I had a candidate once with the perfect résumé who told me she'd been doing the same job for six years because, quote, "she'd mastered it." That was the answer. She wasn't wrong, and she wasn't a bad hire for someone else — but a four-person company runs on people who feel underqualified for their own job for at least the first six months.

Maya: That's a good line. So how do you actually probe for slope in an interview?

Dani: I ask three questions. First: what's something you used to believe about your craft that you no longer believe? If they can't answer, they haven't been paying attention. Second: tell me about a time you changed your mind because of someone junior to you. That's the bar for whether they can actually learn from the team. Third: what would the version of you from two years ago be surprised about? The shape of the answer tells you more than the content.

Maya: Talk to me about the clone trap. You wrote about this — the thing where founders hire people exactly like themselves.

Dani: It's the most dangerous bias I've seen, full stop. You hire someone who interviews great because they reason the way you do, they have the same gaps you do, they laugh at the same jokes. Six months in, your blind spots have been institutionalized. The fix isn't quotas, it's the culture doc — write down what you believe and then notice when every candidate just nods at it. The ones who push back are the ones you need most.

Maya: Last one — your test for whether someone is ready to make their next hire.

Dani: Can you write the one-page culture doc today? Not aspirationally, not the version you wish were true. The actual one. If you can't, you're not ready to hire. The act of having to articulate it is the whole point.

Maya: That's a good place to land. Dani, thanks for coming on.

Dani: Thanks, Maya.`;

const ALL_ON: Record<PlatformKey, boolean> = {
  x: true,
  li: true,
  ig: true,
  tt: true,
  notes: true,
  blog: true,
  news: true,
};

const CheckIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    stroke="#fff"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2.5 6.2l2.3 2.3L9.5 3.5" />
  </svg>
);

const PLATFORM_KEY_TO_ENUM: Record<PlatformKey, Platform> = {
  x: Platform.TWITTER,
  li: Platform.LINKEDIN,
  ig: Platform.INSTAGRAM,
  tt: Platform.TIKTOK,
  notes: Platform.SHOW_NOTES,
  blog: Platform.BLOG,
  news: Platform.NEWSLETTER,
};

export function EpisodeWizard({
  clients = sampleShows,
  initialClientKey,
  episodeCapacity = null,
}: {
  /** Real clients from the data-source layer, or sampleShows fallback. */
  clients?: SampleShow[];
  /** Pre-select a client (from `?clientId=…` on /episodes/new). */
  initialClientKey?: string;
  /** Current episodes-per-month usage. Null in sample-data mode. */
  episodeCapacity?: PlanLimitCapacity | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [clientKey, setClientKey] = useState(initialClientKey ?? clients[0]?.key ?? "ff");
  const [method, setMethod] = useState<Method>("paste");
  const [transcript, setTranscript] = useState("");
  const [rssUrl, setRssUrl] = useState("");
  const [ytUrl, setYtUrl] = useState("");
  const [enabled, setEnabled] = useState<Record<PlatformKey, boolean>>(ALL_ON);
  const [submitting, startSubmit] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const client = useMemo(
    () => clients.find((c) => c.key === clientKey) ?? clients[0],
    [clientKey, clients],
  );

  const wordCount = useMemo(
    () => transcript.trim().split(/\s+/).filter(Boolean).length,
    [transcript],
  );
  const readMins = Math.max(1, Math.round(wordCount / 180));

  const selectedPlatforms = platforms.filter((p) => enabled[p.key]);
  const selectedCount = selectedPlatforms.length;

  const goto = (n: number) => setStep(Math.min(4, Math.max(1, n)));

  const onGenerate = () => {
    setSubmitError(null);
    startSubmit(async () => {
      try {
        const result = await createEpisodeAction({
          clientId: clientKey,
          transcript,
          platforms: selectedPlatforms.map((p) => PLATFORM_KEY_TO_ENUM[p.key]),
        });
        if (!result.ok) {
          setSubmitError(result.error);
          return;
        }
        router.push(`/episodes/${result.episodeId}`);
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : "Failed to create episode");
      }
    });
  };

  return (
    <div className="mx-auto max-w-[860px] px-[30px] pt-[28px] pb-[60px]">
      <div className="mb-[26px]">
        <h1 className="font-display text-ink text-[25px] font-semibold tracking-[-0.5px]">
          New episode
        </h1>
        <p className="text-muted mt-[6px] text-[14px]">
          Turn a recording into platform-ready content in your client&apos;s voice.
        </p>
      </div>

      <Stepper step={step} onJump={goto} />

      <PlanLimitBanner capacity={episodeCapacity} className="mb-4" />

      <div className="border-border bg-surface shadow-card rounded-3xl border p-[26px]">
        {step === 1 && (
          <StepClient clients={clients} currentKey={clientKey} onSelect={setClientKey} />
        )}
        {step === 2 && (
          <StepSource
            method={method}
            onMethod={setMethod}
            transcript={transcript}
            onTranscript={setTranscript}
            wordCount={wordCount}
            readMins={readMins}
            rssUrl={rssUrl}
            onRssUrl={setRssUrl}
            ytUrl={ytUrl}
            onYtUrl={setYtUrl}
            onUseSample={() => setTranscript(SAMPLE_TRANSCRIPT)}
            usingSample={transcript === SAMPLE_TRANSCRIPT}
            onClearSample={() => setTranscript("")}
          />
        )}
        {step === 3 && (
          <StepPlatforms
            enabled={enabled}
            onToggle={(k) => setEnabled((s) => ({ ...s, [k]: !s[k] }))}
            selectedCount={selectedCount}
          />
        )}
        {step === 4 && (
          <StepGenerate
            client={client!}
            method={method}
            wordCount={wordCount}
            selectedPlatforms={selectedPlatforms}
            selectedCount={selectedCount}
            onGenerate={onGenerate}
            submitting={submitting}
            submitError={submitError}
          />
        )}
      </div>

      <FooterNav step={step} onBack={() => goto(step - 1)} onNext={() => goto(step + 1)} />
    </div>
  );
}

/* ============================================================
   Stepper
   ============================================================ */

function Stepper({ step, onJump }: { step: number; onJump: (n: number) => void }) {
  const labels = ["Client", "Source", "Platforms", "Generate"];
  return (
    <div className="mb-[26px] flex items-center">
      {labels.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        return (
          <div key={n} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              onClick={() => onJump(n)}
              className="flex shrink-0 cursor-pointer items-center gap-[10px]"
            >
              <span
                className="flex h-[30px] w-[30px] items-center justify-center rounded-full font-sans text-[13px] font-semibold"
                style={{
                  background: done ? "#E7F4EC" : current ? "var(--color-accent)" : "#fff",
                  color: done ? "#1E7A47" : current ? "#fff" : "#A0A9B8",
                  border: `1.5px solid ${
                    done ? "#BFE3CD" : current ? "var(--color-accent)" : "#D8DEEA"
                  }`,
                }}
              >
                {done ? "✓" : n}
              </span>
              <span
                className="font-sans text-[13px] font-semibold whitespace-nowrap"
                style={{
                  color: current ? "#1A2A4A" : done ? "#1E7A47" : "#A0A9B8",
                }}
              >
                {label}
              </span>
            </button>
            {i < labels.length - 1 && (
              <div
                className="mx-[14px] h-[1.5px] min-w-[18px] flex-1"
                style={{ background: n < step ? "#BFE3CD" : "#E1E6EF" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   Step 1 — Client
   ============================================================ */

function StepClient({
  clients,
  currentKey,
  onSelect,
}: {
  clients: SampleShow[];
  currentKey: string;
  onSelect: (k: string) => void;
}) {
  return (
    <>
      <h2 className="font-display text-ink text-[17px] font-semibold">
        Which client show is this for?
      </h2>
      <p className="text-muted-2 mt-1 mb-5 text-[13px]">
        Outputs will be generated in this client&apos;s voice.
      </p>

      <div className="flex flex-col gap-3">
        {clients.map((c) => {
          const selected = c.key === currentKey;
          const color = voiceTextColor(c.samples);
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onSelect(c.key)}
              className="flex w-full items-center gap-[14px] rounded-[13px] p-[15px] text-left transition-colors hover:border-[#C7D2E6]"
              style={{
                border: `1.5px solid ${selected ? "var(--color-accent)" : "#E6EBF3"}`,
                background: selected ? "#F7F9FE" : "#fff",
              }}
            >
              <span
                className="font-display flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[11px] text-[15px] font-bold text-white"
                style={{ background: c.avatarBg }}
              >
                {c.initial}
              </span>

              <span className="min-w-0 flex-1">
                <span className="font-display text-ink block text-[14.5px] font-semibold">
                  {c.name}
                </span>
                <span className="text-muted mt-[2px] block text-[12.5px]">{c.host}</span>
              </span>

              <span className="flex flex-shrink-0 items-center gap-[9px]">
                <VoiceStrengthBars samples={c.samples} size="sm" />
                <span className="w-[74px] font-sans text-[12px] font-semibold" style={{ color }}>
                  {voiceLabel(c.samples)} · {c.samples}
                </span>
              </span>

              <span
                className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full"
                style={{
                  border: `1.5px solid ${selected ? "var(--color-accent)" : "#CBD4E2"}`,
                  background: selected ? "var(--color-accent)" : "#fff",
                }}
              >
                {selected && <CheckIcon />}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/* ============================================================
   Step 2 — Source
   ============================================================ */

function StepSource({
  method,
  onMethod,
  transcript,
  onTranscript,
  wordCount,
  readMins,
  rssUrl,
  onRssUrl,
  ytUrl,
  onYtUrl,
  onUseSample,
  usingSample,
  onClearSample,
}: {
  method: Method;
  onMethod: (m: Method) => void;
  transcript: string;
  onTranscript: (s: string) => void;
  wordCount: number;
  readMins: number;
  rssUrl: string;
  onRssUrl: (s: string) => void;
  ytUrl: string;
  onYtUrl: (s: string) => void;
  /** Drops the demo transcript into the textarea. */
  onUseSample: () => void;
  /** True when the textarea holds the unedited demo transcript. */
  usingSample: boolean;
  /** Resets the textarea to empty (only shown while `usingSample`). */
  onClearSample: () => void;
}) {
  const isEmpty = transcript.trim().length === 0;
  return (
    <>
      <h2 className="font-display text-ink text-[17px] font-semibold">
        How do you want to add the episode?
      </h2>
      <p className="text-muted-2 mt-1 mb-5 text-[13px]">
        Pick a source — we&apos;ll transcribe and analyze it automatically.
      </p>

      <div className="mb-[22px] grid grid-cols-1 gap-[13px] sm:grid-cols-2">
        {methods.map((m) => {
          const selected = m.key === method;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => onMethod(m.key)}
              className="flex flex-col gap-[11px] rounded-[13px] p-4 text-left transition-colors hover:border-[#C7D2E6]"
              style={{
                border: `1.5px solid ${selected ? m.accent : "#E6EBF3"}`,
                background: selected ? m.tint : "#fff",
              }}
            >
              <span className="flex items-center justify-between">
                <span
                  className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] text-white"
                  style={{ background: m.iconBg }}
                >
                  {m.icon}
                </span>
                <span
                  className="flex h-5 w-5 items-center justify-center rounded-full"
                  style={{
                    border: `1.5px solid ${selected ? m.accent : "#CBD4E2"}`,
                    background: selected ? m.accent : "#fff",
                  }}
                >
                  {selected && <CheckIcon />}
                </span>
              </span>
              <span>
                <span className="font-display text-ink block text-[14px] font-semibold">
                  {m.name}
                </span>
                <span className="text-muted mt-[3px] block text-[12px] leading-[1.4]">
                  {m.desc}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {method === "paste" && (
        <>
          <div className="mb-[9px] flex items-center justify-between">
            <span className="text-ink font-sans text-[13px] font-semibold">Episode transcript</span>
            <span className="text-muted-2 text-[12px]">
              {wordCount} words · ~{readMins} min read
            </span>
          </div>
          <textarea
            value={transcript}
            onChange={(e) => onTranscript(e.target.value)}
            placeholder="Paste the full episode transcript here — speaker labels make the output sharper but aren't required."
            className="h-[230px] w-full resize-y rounded-xl px-[15px] py-[14px] font-sans text-[13px] leading-[1.6] text-[#2A3550] outline-none placeholder:text-[#A6AEBD]"
            style={{ border: "1px solid #C9D4E8", background: "#FBFCFE" }}
          />
          <TranscriptHint
            isEmpty={isEmpty}
            usingSample={usingSample}
            wordCount={wordCount}
            onUseSample={onUseSample}
            onClearSample={onClearSample}
          />
        </>
      )}

      {method === "upload" && (
        <div
          className="rounded-xl bg-[#FBFCFE] p-[38px] text-center"
          style={{ border: "1.5px dashed #C9D4E8" }}
        >
          <div className="mx-auto mb-[14px] flex h-[46px] w-[46px] items-center justify-center rounded-xl bg-[#E7F4EC]">
            <svg
              width="22"
              height="22"
              viewBox="0 0 22 22"
              fill="none"
              stroke="#1E7A47"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 14V4M7 7.5L11 3.5l4 4M4 14v3a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 18 17v-3" />
            </svg>
          </div>
          <div className="text-ink mb-[5px] font-sans text-[14px] font-semibold">
            Drop an audio file or browse
          </div>
          <div className="text-muted-2 text-[12.5px]">MP3, WAV or M4A · up to 500 MB</div>
        </div>
      )}

      {method === "rss" && (
        <>
          <label className="text-ink mb-[9px] block font-sans text-[13px] font-semibold">
            RSS feed URL
          </label>
          <input
            value={rssUrl}
            onChange={(e) => onRssUrl(e.target.value)}
            placeholder="https://feeds.example.com/your-show.xml"
            className="w-full rounded-[10px] px-[14px] py-3 font-sans text-[13.5px] text-[#2A3550] outline-none"
            style={{ border: "1px solid #C9D4E8", background: "#FBFCFE" }}
          />
          <p className="text-muted-2 mt-[9px] text-[12px]">
            We&apos;ll pull the latest episode automatically — or pick one after connecting.
          </p>
        </>
      )}

      {method === "youtube" && (
        <>
          <label className="text-ink mb-[9px] block font-sans text-[13px] font-semibold">
            YouTube URL
          </label>
          <input
            value={ytUrl}
            onChange={(e) => onYtUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=…"
            className="w-full rounded-[10px] px-[14px] py-3 font-sans text-[13.5px] text-[#2A3550] outline-none"
            style={{ border: "1px solid #C9D4E8", background: "#FBFCFE" }}
          />
          <p className="text-muted-2 mt-[9px] text-[12px]">
            We&apos;ll grab the captions and audio to build the transcript.
          </p>
        </>
      )}
    </>
  );
}

/**
 * Below-textarea status row for the paste step. Three states:
 *  - empty           → "Don't have one handy? Use a sample transcript"
 *  - sample loaded   → "Demo transcript loaded · clear"
 *  - real content    → word-count gate (amber under 500, green at/over)
 */
function TranscriptHint({
  isEmpty,
  usingSample,
  wordCount,
  onUseSample,
  onClearSample,
}: {
  isEmpty: boolean;
  usingSample: boolean;
  wordCount: number;
  onUseSample: () => void;
  onClearSample: () => void;
}) {
  if (isEmpty) {
    return (
      <div className="text-muted-2 mt-[10px] flex items-center justify-between gap-3 text-[12px]">
        <span>No transcript yet — paste yours above, or try the engine on a sample.</span>
        <button
          type="button"
          onClick={onUseSample}
          className="border-accent-border bg-accent-soft text-accent rounded-md border px-[10px] py-1 font-sans text-[12px] font-semibold transition-colors hover:bg-white"
        >
          Use a sample transcript
        </button>
      </div>
    );
  }
  if (usingSample) {
    return (
      <div className="text-accent mt-[10px] flex items-center justify-between gap-3 text-[12px]">
        <span className="flex items-center gap-[7px]">
          <span className="bg-accent block h-[7px] w-[7px] rounded-full" />
          Demo transcript loaded — edit it or clear to paste your own.
        </span>
        <button
          type="button"
          onClick={onClearSample}
          className="text-muted-2 hover:bg-canvas hover:text-ink rounded-md px-2 py-1 font-sans text-[12px] font-medium transition-colors"
        >
          Clear sample
        </button>
      </div>
    );
  }
  if (wordCount < 500) {
    return (
      <div className="mt-[10px] flex items-center gap-[7px] text-[12px] text-[#A06D12]">
        <span className="block h-[7px] w-[7px] rounded-full bg-[#C9952B]" />
        {wordCount === 0 ? "Empty" : `${wordCount} words`} — needs at least 500 words before we can
        generate.
      </div>
    );
  }
  return (
    <div className="mt-[10px] flex items-center gap-[7px] text-[12px] text-[#1E7A47]">
      <span className="block h-[7px] w-[7px] rounded-full bg-[#2E9E5B]" />
      Transcript looks good — ready to generate.
    </div>
  );
}

/* ============================================================
   Step 3 — Platforms
   ============================================================ */

function StepPlatforms({
  enabled,
  onToggle,
  selectedCount,
}: {
  enabled: Record<PlatformKey, boolean>;
  onToggle: (k: PlatformKey) => void;
  selectedCount: number;
}) {
  return (
    <>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-ink text-[17px] font-semibold">
            What should we generate?
          </h2>
          <p className="text-muted-2 mt-1 text-[13px]">
            Toggle the platforms you need for this episode.
          </p>
        </div>
        <span className="rounded-pill bg-accent-soft text-accent px-3 py-[6px] font-sans text-[12.5px] font-semibold whitespace-nowrap">
          {selectedCount} selected
        </span>
      </div>

      <div className="flex flex-col gap-[10px]">
        {platforms.map((p) => {
          const on = enabled[p.key];
          return (
            <div
              key={p.key}
              className="flex items-center gap-[13px] rounded-xl px-[15px] py-[13px]"
              style={{
                border: `1px solid ${on ? "#D6DEEC" : "#EDF0F5"}`,
                background: on ? "#FAFBFE" : "#fff",
              }}
            >
              <span
                className="font-display flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px] text-[13px] font-bold"
                style={{
                  background: p.badgeBg,
                  color: p.badgeColor,
                  border: `1px solid ${p.badgeBorder}`,
                }}
              >
                {p.badge}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-ink font-sans text-[13.5px] font-semibold">{p.fullName}</div>
                <div className="text-muted-2 mt-[1px] text-[12px]">{p.desc}</div>
              </div>
              <Toggle
                checked={on}
                onChange={() => onToggle(p.key)}
                label={`${p.fullName} ${on ? "enabled" : "disabled"}`}
              />
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ============================================================
   Step 4 — Generate
   ============================================================ */

function StepGenerate({
  client,
  method,
  wordCount,
  selectedPlatforms,
  selectedCount,
  onGenerate,
  submitting,
  submitError,
}: {
  client: SampleShow;
  method: Method;
  wordCount: number;
  selectedPlatforms: typeof platforms;
  selectedCount: number;
  onGenerate: () => void;
  submitting: boolean;
  submitError: string | null;
}) {
  const m = methods.find((x) => x.key === method)!;
  const sourceMeta = {
    paste: `${wordCount} words`,
    upload: "audio · transcribing",
    rss: "latest episode",
    youtube: "captions + audio",
  }[method];

  return (
    <>
      <h2 className="font-display text-ink text-[17px] font-semibold">Ready to generate</h2>
      <p className="text-muted-2 mt-1 mb-5 text-[13px]">
        Review the setup, then generate. You&apos;ll approve each output next.
      </p>

      <div className="border-border mb-[22px] flex flex-col gap-[1px] overflow-hidden rounded-[13px] border bg-[#EEF1F6]">
        <div className="flex items-center gap-[13px] bg-white p-[15px]">
          <span className="text-muted-2 w-[84px] font-sans text-[12px] font-medium">Client</span>
          <span
            className="font-display flex h-[30px] w-[30px] items-center justify-center rounded-md text-[11px] font-bold text-white"
            style={{ background: client.avatarBg }}
          >
            {client.initial}
          </span>
          <span className="text-ink font-sans text-[13.5px] font-semibold">{client.name}</span>
          <span
            className="rounded-pill ml-auto inline-flex items-center gap-[5px] px-[9px] py-[3px] font-sans text-[11px] font-semibold"
            style={{
              background: voiceBg(client.samples),
              color: voiceTextColor(client.samples),
            }}
          >
            {voiceLabel(client.samples)} voice
          </span>
        </div>

        <div className="flex items-center gap-[13px] bg-white p-[15px]">
          <span className="text-muted-2 w-[84px] font-sans text-[12px] font-medium">Source</span>
          <span
            className="flex h-[30px] w-[30px] items-center justify-center rounded-md text-white"
            style={{ background: m.iconBg }}
          >
            {m.icon}
          </span>
          <span className="text-ink font-sans text-[13.5px] font-semibold">{m.name}</span>
          <span className="text-muted-2 ml-auto text-[12.5px]">{sourceMeta}</span>
        </div>

        <div className="flex items-start gap-[13px] bg-white p-[15px]">
          <span className="text-muted-2 w-[84px] pt-[5px] font-sans text-[12px] font-medium">
            Platforms
          </span>
          <div className="flex flex-wrap gap-[7px]">
            {selectedPlatforms.map((sp) => (
              <span
                key={sp.key}
                className="border-border bg-canvas inline-flex items-center gap-[6px] rounded-md border px-[9px] py-[5px] font-sans text-[12px] font-medium text-[#39435A]"
              >
                <span
                  className="font-display flex h-[18px] w-[18px] items-center justify-center rounded-[5px] text-[9px] font-bold"
                  style={{
                    background: sp.badgeBg,
                    color: sp.badgeColor,
                    border: `1px solid ${sp.badgeBorder}`,
                  }}
                >
                  {sp.badge}
                </span>
                {sp.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* The paste path needs a >= 500-word transcript to clear the server
          validator. Gate the button here so the failure surfaces before the
          submit round-trip instead of as a generic error toast. Non-paste
          sources don't go through this validator yet (audio/RSS/YouTube
          land in Phase 2). */}
      {(() => {
        const transcriptTooShort = method === "paste" && wordCount < 500;
        const disabled = selectedCount === 0 || submitting || transcriptTooShort;
        return (
          <>
            <button
              type="button"
              onClick={onGenerate}
              disabled={disabled}
              className="bg-accent shadow-card-hover flex w-full items-center justify-center gap-[9px] rounded-xl px-4 py-[15px] font-sans text-[15px] font-semibold text-white transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ border: "1px solid rgba(0,0,0,.06)" }}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 17 17"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 1.5L3 9.5h4l-1 6 6-8H8z" />
              </svg>
              {submitting
                ? `Starting…`
                : `Generate ${selectedCount} outputs in ${client.host}'s voice`}
            </button>
            {submitError && (
              <div className="mt-3 text-center text-[12px] text-[#A06D12]">{submitError}</div>
            )}
            {!submitError && transcriptTooShort && (
              <div className="mt-3 text-center text-[12px] text-[#A06D12]">
                Add at least 500 words to the transcript on step 2 before generating.
              </div>
            )}
            {!submitError && !transcriptTooShort && (
              <div className="text-subtle mt-3 text-center text-[12px]">
                Typically ready in under a minute
              </div>
            )}
          </>
        );
      })()}
    </>
  );
}

/* ============================================================
   Footer nav
   ============================================================ */

function FooterNav({
  step,
  onBack,
  onNext,
}: {
  step: number;
  onBack: () => void;
  onNext: () => void;
}) {
  const backDisabled = step === 1;
  return (
    <div className="mt-5 flex items-center justify-between">
      <Button
        variant="secondary"
        onClick={onBack}
        disabled={backDisabled}
        leadingIcon={
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8.5 3L4.5 7l4 4" />
          </svg>
        }
      >
        Back
      </Button>

      <div className="text-subtle text-[12.5px]">Step {step} of 4</div>

      {step < 4 ? (
        <Button
          onClick={onNext}
          trailingIcon={
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5.5 3l4 4-4 4" />
            </svg>
          }
        >
          Continue
        </Button>
      ) : (
        <div className="w-[120px]" />
      )}
    </div>
  );
}
