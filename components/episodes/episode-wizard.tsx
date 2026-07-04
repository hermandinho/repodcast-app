"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Platform, TranscriptSource } from "@/lib/enums";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { VoiceStrengthBars } from "@/components/ui/voice-strength-bars";
import { PlanLimitBanner, type PlanLimitCapacity } from "@/components/billing/plan-limit-banner";
import { AudioUpload, type AudioUploadValue } from "@/components/episodes/audio-upload";
import { RssFeedPicker, type RssSelection } from "@/components/episodes/rss-feed-picker";
import { sampleShows, type SampleShow } from "@/lib/sample-data/shows";
import { platforms, type PlatformKey } from "@/lib/sample-data/platforms";
import { voiceBg, voiceLabel, voiceTextColor } from "@/lib/sample-data/voice-strength";
import { formatAudioSize } from "@/lib/audio";
import { createEpisodeAction } from "@/app/(dashboard)/episodes/new/actions";

type Method = "paste" | "upload" | "rss" | "youtube";

/**
 * Kill switch for the yt-dlp-backed YouTube import tile. Off in prod
 * because YouTube's anti-bot check blocks yt-dlp from Vercel egress IPs.
 * Users see the upload tile's YouTube-Studio hint instead. Server-side
 * guards in `createEpisodeAction` and `importYoutubeEpisode` enforce the
 * same flag in case a stale client tab makes it through. `NEXT_PUBLIC_*`
 * is inlined at build time so this reads cleanly in a client component.
 */
const YOUTUBE_IMPORT_ENABLED = process.env.NEXT_PUBLIC_ENABLE_YOUTUBE_IMPORT === "true";

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
    desc: "MP3, WAV or M4A — coming from YouTube? Export from Studio → Content → Download.",
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
 * Tiles surfaced in the source picker. Kept separate from `methods` so
 * `StepGenerate` can still resolve a "youtube" meta if a stale client
 * state somehow reaches step 4 with that method selected — the server
 * action is the authoritative reject.
 */
const visibleMethods: MethodMeta[] = methods.filter(
  (m) => m.key !== "youtube" || YOUTUBE_IMPORT_ENABLED,
);

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

/**
 * Client-side hint that a pasted YouTube URL is well-formed enough to
 * attempt the import. The authoritative parser lives in
 * `server/imports/youtube.ts#parseYouTubeVideoId` and re-runs inside the
 * Inngest fn; this one is only for wizard gating so the CTA isn't enabled
 * on obvious junk. Duplicated intentionally — importing the server-only
 * module into a client component would break the "use client" boundary.
 */
function isPlausibleYouTubeUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return true;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return false;
  }
  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  if (host === "youtu.be") {
    const seg = url.pathname.replace(/^\//, "").split("/")[0];
    return Boolean(seg && /^[A-Za-z0-9_-]{11}$/.test(seg));
  }
  if (host === "youtube.com" || host === "music.youtube.com") {
    const v = url.searchParams.get("v");
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return true;
    return /^\/(?:embed|shorts|live|v)\/[A-Za-z0-9_-]{11}/.test(url.pathname);
  }
  return false;
}

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

/** Lightweight shape for the client-filter chip row on step 1. */
export type WizardClientOption = {
  id: string;
  name: string;
};

export function EpisodeWizard({
  shows = sampleShows,
  clients = [],
  initialShowKey,
  initialClientId,
  episodeCapacity = null,
}: {
  /** All shows the agency owns, in display order. */
  shows?: SampleShow[];
  /** All clients the agency owns — drives the step-1 filter chip row. */
  clients?: WizardClientOption[];
  /** Pre-select a show (from `?showId=…` on /episodes/new). */
  initialShowKey?: string;
  /**
   * Pre-select a client filter (from `?clientId=…`). When set without
   * `initialShowKey`, the first show owned by that client becomes the
   * default selection.
   */
  initialClientId?: string;
  /** Current episodes-per-month usage. Null in sample-data mode. */
  episodeCapacity?: PlanLimitCapacity | null;
}) {
  const router = useRouter();

  // Resolve the initial client filter and show selection in order of
  // precedence: explicit `initialShowKey` → its parent's clientKey →
  // explicit `initialClientId` → first client overall. The "no filter"
  // (all clients) is the implicit default when nothing matches.
  const seedShow = initialShowKey ? shows.find((s) => s.key === initialShowKey) : null;
  const seedClientId = seedShow?.clientKey ?? initialClientId ?? null;

  const [step, setStep] = useState(1);
  const [clientFilter, setClientFilter] = useState<string | null>(seedClientId);
  const [showId, setShowId] = useState(() => {
    if (seedShow) return seedShow.key;
    if (seedClientId) {
      const firstInClient = shows.find((s) => s.clientKey === seedClientId);
      if (firstInClient) return firstInClient.key;
    }
    return shows[0]?.key ?? "ff";
  });
  const [title, setTitle] = useState("");
  const [method, setMethod] = useState<Method>("paste");
  const [transcript, setTranscript] = useState("");
  const [audio, setAudio] = useState<AudioUploadValue | null>(null);
  const [rssSelection, setRssSelection] = useState<RssSelection | null>(null);
  const [ytUrl, setYtUrl] = useState("");
  const [enabled, setEnabled] = useState<Record<PlatformKey, boolean>>(ALL_ON);
  const [submitting, startSubmit] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Shows visible to the show-picker — narrowed when a client filter is on.
  const visibleShows = useMemo(
    () => (clientFilter ? shows.filter((s) => s.clientKey === clientFilter) : shows),
    [clientFilter, shows],
  );

  const client = useMemo(() => shows.find((s) => s.key === showId) ?? shows[0], [showId, shows]);

  const wordCount = useMemo(
    () => transcript.trim().split(/\s+/).filter(Boolean).length,
    [transcript],
  );
  const readMins = Math.max(1, Math.round(wordCount / 180));

  const selectedPlatforms = platforms.filter((p) => enabled[p.key]);
  const selectedCount = selectedPlatforms.length;

  // ------------------------------------------------------------------
  // Per-step validity gates. Step 4 is the terminal "Generate" screen —
  // its own readiness check lives inside <StepGenerate> and gates the
  // submit CTA, not forward navigation. Steps 1–3 must satisfy the
  // criteria below before the Continue button (or a forward stepper
  // jump) is allowed to land on the next step.
  //   1 Show       — a show is selected (always true once shows load).
  //   2 Source     — method-dependent: paste ≥ 500 words, upload has an
  //                  uploaded audio object, rss has a picked episode,
  //                  youtube has a URL that parses as a video id.
  //   3 Platforms  — at least one platform toggled on.
  // ------------------------------------------------------------------
  const stepValid: [boolean, boolean, boolean, boolean] = useMemo(() => {
    const step1 = Boolean(showId) && shows.some((s) => s.key === showId);
    const step2 =
      method === "paste"
        ? wordCount >= 500
        : method === "upload"
          ? audio !== null
          : method === "rss"
            ? rssSelection !== null
            : method === "youtube"
              ? isPlausibleYouTubeUrl(ytUrl)
              : false;
    const step3 = selectedCount > 0;
    return [step1, step2, step3, true];
  }, [showId, shows, method, wordCount, audio, rssSelection, ytUrl, selectedCount]);

  /** Short, per-step hint to surface under a disabled Continue. */
  const stepHint = (n: number): string | null => {
    if (n === 1 && !stepValid[0]) return "Pick a show to continue.";
    if (n === 2 && !stepValid[1]) {
      if (method === "paste")
        return `Paste a transcript of 500+ words to continue (${wordCount} so far).`;
      if (method === "upload") return "Upload an audio file to continue.";
      if (method === "rss") return "Pick an episode from the connected feed to continue.";
      if (method === "youtube")
        return "Paste a YouTube URL (watch, youtu.be, shorts, or embed) to continue.";
    }
    if (n === 3 && !stepValid[2]) return "Pick at least one platform to continue.";
    return null;
  };

  /**
   * Forward jumps are only allowed when every step between the current
   * one and the target is valid. Backward jumps are always allowed so
   * the user can revisit + fix earlier steps. Defensive clamp at 1..4.
   */
  const goto = (n: number) => {
    const clamped = Math.min(4, Math.max(1, n));
    if (clamped <= step) {
      setStep(clamped);
      return;
    }
    for (let i = step; i < clamped; i++) {
      if (!stepValid[i - 1]) {
        // Land on the first invalid step instead of silently no-op'ing —
        // the user clicked something, they should see *why* it stopped.
        setStep(i);
        return;
      }
    }
    setStep(clamped);
  };

  const onGenerate = () => {
    setSubmitError(null);
    startSubmit(async () => {
      try {
        // Source-aware payload. PASTE carries the transcript; UPLOAD
        // carries the R2 object key returned by signAudioUploadAction;
        // RSS carries the publisher GUID + canonical feed URL; YOUTUBE
        // carries the pasted video URL (parsed authoritatively inside
        // the Inngest fn).
        const trimmedTitle = title.trim();
        const source =
          method === "upload"
            ? TranscriptSource.UPLOAD
            : method === "rss"
              ? TranscriptSource.RSS
              : method === "youtube"
                ? TranscriptSource.YOUTUBE
                : TranscriptSource.PASTE;
        const result = await createEpisodeAction({
          showId,
          // Optional — server defaults to "Untitled episode" when blank
          // so users can leave it for later and rename from the episode
          // page header. For RSS, fall back to the publisher-supplied
          // title when the user hasn't overridden it.
          title: trimmedTitle.length > 0 ? trimmedTitle : method === "rss" ? undefined : undefined,
          source,
          transcript: source === TranscriptSource.PASTE ? transcript : "",
          audioObjectKey:
            source === TranscriptSource.UPLOAD ? (audio?.objectKey ?? undefined) : undefined,
          // Pre-minted by signAudioUploadAction so Episode.id matches the
          // id embedded in the R2 object key.
          episodeId:
            source === TranscriptSource.UPLOAD ? (audio?.episodeId ?? undefined) : undefined,
          rssGuid: source === TranscriptSource.RSS ? rssSelection?.guid : undefined,
          rssFeedUrl: source === TranscriptSource.RSS ? rssSelection?.feedUrl : undefined,
          rssTitle: source === TranscriptSource.RSS ? rssSelection?.title : undefined,
          youtubeUrl: source === TranscriptSource.YOUTUBE ? ytUrl.trim() : undefined,
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

      <Stepper step={step} stepValid={stepValid} onJump={goto} />

      <PlanLimitBanner capacity={episodeCapacity} className="mb-4" />

      <div className="border-border bg-surface shadow-card rounded-3xl border p-[26px]">
        {step === 1 && (
          <StepShow
            shows={visibleShows}
            allShowsCount={shows.length}
            clients={clients}
            clientFilter={clientFilter}
            onClientFilter={(nextClient) => {
              setClientFilter(nextClient);
              // When the user narrows by client and the currently-selected
              // show falls outside the new scope, auto-jump to the first
              // show in the filtered list so the selection stays valid.
              const stillVisible =
                nextClient == null ||
                shows.some((s) => s.key === showId && s.clientKey === nextClient);
              if (!stillVisible) {
                const next = shows.find((s) => s.clientKey === nextClient)?.key ?? shows[0]?.key;
                if (next) {
                  setShowId(next);
                  if (audio) setAudio(null);
                }
              }
            }}
            currentKey={showId}
            onSelect={(nextKey) => {
              setShowId(nextKey);
              // Audio object key embeds the showId — switching shows after
              // an upload would leave the file mis-attributed. Drop it so
              // the user re-uploads under the right path.
              if (nextKey !== showId && audio) setAudio(null);
            }}
          />
        )}
        {step === 2 && (
          <StepSource
            showId={showId}
            showRssUrl={client?.rssUrl ?? null}
            method={method}
            onMethod={setMethod}
            transcript={transcript}
            onTranscript={setTranscript}
            wordCount={wordCount}
            readMins={readMins}
            audio={audio}
            onAudio={setAudio}
            rssSelection={rssSelection}
            onRssSelection={setRssSelection}
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
            audio={audio}
            rssSelection={rssSelection}
            ytUrl={ytUrl}
            title={title}
            onTitle={setTitle}
            selectedPlatforms={selectedPlatforms}
            selectedCount={selectedCount}
            onGenerate={onGenerate}
            submitting={submitting}
            submitError={submitError}
          />
        )}
      </div>

      <FooterNav
        step={step}
        nextDisabled={!stepValid[step - 1]}
        nextHint={stepHint(step)}
        onBack={() => goto(step - 1)}
        onNext={() => goto(step + 1)}
      />
    </div>
  );
}

/* ============================================================
   Stepper
   ============================================================ */

function Stepper({
  step,
  stepValid,
  onJump,
}: {
  step: number;
  /** Per-step validity (1-indexed via [n-1]). Forward jumps over an invalid step are blocked. */
  stepValid: readonly [boolean, boolean, boolean, boolean];
  onJump: (n: number) => void;
}) {
  const labels = ["Show", "Source", "Platforms", "Review & generate"];
  return (
    <div className="mb-[26px] flex items-center">
      {labels.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const current = n === step;
        // A forward jump from `step` to `n` is reachable iff every step
        // in `[step, n)` is valid. Backward jumps + the current step are
        // always reachable.
        const reachable = n <= step || stepValid.slice(step - 1, n - 1).every(Boolean);
        return (
          <div key={n} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              onClick={() => onJump(n)}
              disabled={!reachable}
              aria-disabled={!reachable}
              title={!reachable ? "Finish the earlier step first." : undefined}
              className="flex shrink-0 items-center gap-[10px] disabled:cursor-not-allowed"
              style={{ cursor: reachable ? "pointer" : "not-allowed" }}
            >
              <span
                className="flex h-[30px] w-[30px] items-center justify-center rounded-full font-sans text-[13px] font-semibold"
                style={{
                  background: done ? "#E7F4EC" : current ? "var(--color-accent)" : "#fff",
                  color: done ? "#1E7A47" : current ? "#fff" : "#A0A9B8",
                  border: `1.5px solid ${
                    done ? "#BFE3CD" : current ? "var(--color-accent)" : "#D8DEEA"
                  }`,
                  opacity: reachable ? 1 : 0.55,
                }}
              >
                {done ? "✓" : n}
              </span>
              <span
                className="font-sans text-[13px] font-semibold whitespace-nowrap"
                style={{
                  color: current ? "#1A2A4A" : done ? "#1E7A47" : "#A0A9B8",
                  opacity: reachable ? 1 : 0.55,
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
   Step 1 — Show (with optional client filter)
   ============================================================ */

function StepShow({
  shows,
  allShowsCount,
  clients,
  clientFilter,
  onClientFilter,
  currentKey,
  onSelect,
}: {
  /** Already filtered by `clientFilter` upstream. */
  shows: SampleShow[];
  /** Total shows across all clients — drives the "All clients · N" badge. */
  allShowsCount: number;
  clients: WizardClientOption[];
  clientFilter: string | null;
  onClientFilter: (clientId: string | null) => void;
  currentKey: string;
  onSelect: (k: string) => void;
}) {
  // Only render the client filter when there's more than one client to
  // choose from. Solo-client agencies (most STUDIO plans) don't need it.
  const showFilter = clients.length > 1;

  return (
    <>
      <h2 className="font-display text-ink text-[17px] font-semibold">
        Which show is this episode for?
      </h2>
      <p className="text-muted-2 mt-1 mb-5 text-[13px]">
        Outputs will be generated in this show&apos;s voice.
      </p>

      {showFilter && (
        <div className="mb-5">
          <div className="text-muted-2 mb-[8px] font-sans text-[11px] font-semibold tracking-[0.06em] uppercase">
            Filter by client
          </div>
          <div
            className="flex flex-wrap gap-[6px]"
            role="radiogroup"
            aria-label="Filter shows by client"
          >
            <ClientFilterChip
              label="All clients"
              count={allShowsCount}
              active={clientFilter === null}
              onClick={() => onClientFilter(null)}
            />
            {clients.map((c) => (
              <ClientFilterChip
                key={c.id}
                label={c.name}
                active={clientFilter === c.id}
                onClick={() => onClientFilter(c.id)}
              />
            ))}
          </div>
        </div>
      )}

      {shows.length === 0 ? (
        <div className="border-border bg-canvas rounded-2xl border border-dashed px-6 py-10 text-center">
          <h3 className="font-display text-ink text-[14.5px] font-semibold">
            This client has no shows yet
          </h3>
          <p className="text-muted-2 mx-auto mt-1 max-w-[360px] text-[12.5px]">
            Add a show to this client first, then come back to create an episode. Or pick a
            different client above.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {shows.map((c) => {
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
      )}
    </>
  );
}

function ClientFilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="radio"
      aria-checked={active}
      className="inline-flex items-center gap-[6px] rounded-full px-[11px] py-[5px] font-sans text-[12.5px] font-medium transition-colors"
      style={{
        border: `1.5px solid ${active ? "var(--color-accent)" : "#E1E6EF"}`,
        background: active ? "var(--color-accent-soft)" : "#fff",
        color: active ? "var(--color-accent)" : "#5A6473",
      }}
    >
      <span className="max-w-[200px] truncate">{label}</span>
      {typeof count === "number" && (
        <span
          className="rounded-pill px-[7px] py-[1px] font-sans text-[10.5px] font-semibold"
          style={{
            background: active ? "var(--color-accent)" : "#EEF1F6",
            color: active ? "#fff" : "#7A8496",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/* ============================================================
   Step 2 — Source
   ============================================================ */

function StepSource({
  showId,
  showRssUrl,
  method,
  onMethod,
  transcript,
  onTranscript,
  wordCount,
  readMins,
  audio,
  onAudio,
  rssSelection,
  onRssSelection,
  ytUrl,
  onYtUrl,
  onUseSample,
  usingSample,
  onClearSample,
}: {
  showId: string;
  /** Persisted `Show.rssUrl` for the current show, null when none connected. */
  showRssUrl: string | null;
  method: Method;
  onMethod: (m: Method) => void;
  transcript: string;
  onTranscript: (s: string) => void;
  wordCount: number;
  readMins: number;
  audio: AudioUploadValue | null;
  onAudio: (next: AudioUploadValue | null) => void;
  rssSelection: RssSelection | null;
  onRssSelection: (next: RssSelection | null) => void;
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
        {visibleMethods.map((m) => {
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
        <>
          <AudioUpload showId={showId} value={audio} onChange={onAudio} />
          <p className="text-muted-2 mt-[10px] text-[12px]">
            We&apos;ll transcribe the audio for you once you generate — usually under a minute. Your
            file stays private to your workspace.
          </p>
        </>
      )}

      {method === "rss" && (
        // `key={showId}` remounts the picker when the user picks a
        // different show in step 1, so its internal state (urlInput,
        // feedUrl, episode list) re-derives from the new `initialFeedUrl`
        // without a prop-sync useEffect — see the picker's mount-only
        // useEffect for the rationale.
        <RssFeedPicker
          key={showId}
          showId={showId}
          initialFeedUrl={showRssUrl}
          selected={rssSelection}
          onSelect={onRssSelection}
        />
      )}

      {YOUTUBE_IMPORT_ENABLED && method === "youtube" && (
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
  audio,
  rssSelection,
  ytUrl,
  title,
  onTitle,
  selectedPlatforms,
  selectedCount,
  onGenerate,
  submitting,
  submitError,
}: {
  client: SampleShow;
  method: Method;
  wordCount: number;
  audio: AudioUploadValue | null;
  rssSelection: RssSelection | null;
  ytUrl: string;
  title: string;
  onTitle: (next: string) => void;
  selectedPlatforms: typeof platforms;
  selectedCount: number;
  onGenerate: () => void;
  submitting: boolean;
  submitError: string | null;
}) {
  const m = methods.find((x) => x.key === method)!;
  const sourceMeta = {
    paste: `${wordCount} words`,
    upload: audio ? `${audio.filename} · ${formatAudioSize(audio.size)}` : "no audio uploaded yet",
    rss: rssSelection?.title ?? "no episode picked yet",
    youtube: ytUrl.trim().length > 0 ? ytUrl.trim() : "no URL yet",
  }[method];

  return (
    <>
      <h2 className="font-display text-ink text-[17px] font-semibold">Review &amp; generate</h2>
      <p className="text-muted-2 mt-1 mb-5 text-[13px]">
        Name the episode, double-check the setup, then generate. You&apos;ll approve each output
        next.
      </p>

      {/* Episode title — optional; defaults to "Untitled episode" server-side */}
      <label className="text-ink mb-[8px] block font-sans text-[13px] font-semibold">
        Episode title
      </label>
      <input
        value={title}
        onChange={(e) => onTitle(e.target.value)}
        placeholder="e.g. Why your first 10 hires define everything"
        maxLength={240}
        className="mb-1 w-full rounded-[10px] px-[14px] py-[10px] font-sans text-[14px] text-[#2A3550] outline-none placeholder:text-[#A6AEBD]"
        style={{ border: "1px solid #C9D4E8", background: "#FBFCFE" }}
      />
      <p className="text-muted-2 mb-[18px] text-[12px]">
        Leave blank to save as &ldquo;Untitled episode&rdquo; — you can rename it from the episode
        page.
      </p>

      <div className="border-border mb-[22px] flex flex-col gap-[1px] overflow-hidden rounded-[13px] border bg-[#EEF1F6]">
        <div className="flex items-center gap-[13px] bg-white p-[15px]">
          <span className="text-muted-2 w-[84px] font-sans text-[12px] font-medium">Show</span>
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

      {/* Gate per source so the failure surfaces before the submit round-
          trip rather than as a generic error toast. Paste needs ≥ 500
          words, upload needs an uploaded audio object, RSS needs a
          picked episode, YouTube needs a URL that parses as a video id. */}
      {(() => {
        const transcriptTooShort = method === "paste" && wordCount < 500;
        const audioMissing = method === "upload" && !audio;
        const rssMissing = method === "rss" && !rssSelection;
        const ytMissing = method === "youtube" && !isPlausibleYouTubeUrl(ytUrl);
        const disabled =
          selectedCount === 0 ||
          submitting ||
          transcriptTooShort ||
          audioMissing ||
          rssMissing ||
          ytMissing;
        const startingLabel =
          method === "upload"
            ? "Uploading…"
            : method === "rss"
              ? "Importing…"
              : method === "youtube"
                ? "Importing…"
                : "Starting…";
        const ctaLabel =
          method === "upload"
            ? `Transcribe + generate ${selectedCount} outputs`
            : method === "rss"
              ? `Import + generate ${selectedCount} outputs in ${client.host}'s voice`
              : method === "youtube"
                ? `Import + generate ${selectedCount} outputs in ${client.host}'s voice`
                : `Generate ${selectedCount} outputs in ${client.host}'s voice`;
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
              {submitting ? startingLabel : ctaLabel}
            </button>
            {submitError && (
              <div className="mt-3 text-center text-[12px] text-[#A06D12]">{submitError}</div>
            )}
            {!submitError && transcriptTooShort && (
              <div className="mt-3 text-center text-[12px] text-[#A06D12]">
                Add at least 500 words to the transcript on step 2 before generating.
              </div>
            )}
            {!submitError && audioMissing && (
              <div className="mt-3 text-center text-[12px] text-[#A06D12]">
                Upload an audio file on step 2 before generating.
              </div>
            )}
            {!submitError && rssMissing && (
              <div className="mt-3 text-center text-[12px] text-[#A06D12]">
                Pick an episode from the connected feed on step 2 before generating.
              </div>
            )}
            {!submitError && ytMissing && (
              <div className="mt-3 text-center text-[12px] text-[#A06D12]">
                Paste a YouTube URL on step 2 before generating.
              </div>
            )}
            {!submitError && !transcriptTooShort && !audioMissing && !rssMissing && !ytMissing && (
              <div className="text-subtle mt-3 text-center text-[12px]">
                {method === "upload"
                  ? "Transcription usually takes 30–90 seconds, then generation kicks in."
                  : method === "rss"
                    ? "We'll pull the publisher's transcript or download the audio — usually a minute or two before generation begins."
                    : method === "youtube"
                      ? "We'll pull captions from YouTube — usually a few seconds before generation begins."
                      : "Typically ready in under a minute"}
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
  nextDisabled,
  nextHint,
  onBack,
  onNext,
}: {
  step: number;
  /** Disables the Continue button when the current step's data isn't complete. */
  nextDisabled: boolean;
  /** Short reason surfaced under the button when `nextDisabled`. */
  nextHint: string | null;
  onBack: () => void;
  onNext: () => void;
}) {
  const backDisabled = step === 1;
  return (
    <div className="mt-5 flex items-start justify-between">
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

      <div className="text-subtle pt-[10px] text-[12.5px]">Step {step} of 4</div>

      {step < 4 ? (
        <div className="flex flex-col items-end gap-1">
          <Button
            onClick={onNext}
            disabled={nextDisabled}
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
          {nextDisabled && nextHint && (
            <span className="max-w-[260px] text-right text-[11.5px] text-[#A06D12]">
              {nextHint}
            </span>
          )}
        </div>
      ) : (
        <div className="w-[120px]" />
      )}
    </div>
  );
}
