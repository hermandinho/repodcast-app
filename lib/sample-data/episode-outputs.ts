import type { KeyMoment } from "@/server/ai/key-moments";
import type { EpisodeStatus } from "./episode-status";
import type { PlatformKey } from "./platforms";

export type SampleOutput = {
  /** Platform key — also serves as the output's UI grid key within an episode. */
  key: PlatformKey;
  /**
   * Real DB id when live, falls back to `key` in sample-data mode. The UI
   * passes this to server actions (edit / approve / regenerate / version
   * history) — must be the actual GeneratedOutput row id in live mode.
   */
  id: string;
  /** Sub-label shown under the platform name (e.g. "Thread · 6 posts"). */
  meta: string;
  status: EpisodeStatus;
  quality: number;
  content: string;
  /** 1-indexed version number within the (episode, platform) slot. */
  version: number;
  /** Total number of versions in this slot (>= 1). Drives the switcher. */
  versionCount: number;
  /** Set when status is "failed" — the underlying error from the pipeline. */
  failureReason?: string | null;
  /** Phase 3.3 — populated when status ∈ {"scheduled", "published"}. */
  scheduledForIso?: string | null;
  publishedAtIso?: string | null;
  externalScheduler?: "BUFFER" | "MANUAL" | null;
  externalPostUrl?: string | null;
  /** Populated when the parent client runs the CLIENT validation flow and
   *  this output is either sitting in the portal awaiting approval or has
   *  been approved by the end client. Terminal freeze once the client
   *  approves — no more edits / regenerations from anyone. */
  sentToClientAtIso?: string | null;
  clientApprovedAtIso?: string | null;
  /** Derived signal — the client requested changes via the portal and the
   *  agency hasn't acted on the feedback yet. Present when the output's
   *  most recent transition is `AWAITING_CLIENT_APPROVAL → READY`; cleared
   *  by any subsequent transition (approve, request review, regen). Paired
   *  with an optional short note from the client (transition audit note). */
  clientRevisionRequestedAtIso?: string | null;
  clientRevisionNote?: string | null;
  /**
   * Cumulative Levenshtein delta on this row's current version — powers
   * the "shipped X% unedited" readout on the drawer for approved /
   * published rows. Optional so sample-data fixtures can omit it; live
   * rows always carry a number (column default `0`).
   */
  editDistance?: number;
};

export type SampleEpisode = {
  /**
   * Real Episode.id when live; falls back to the show key in sample-data
   * mode (the wizard's sample-mode short-circuit routes by show key, so
   * the page resolves either form). Required by client islands that need
   * to call server actions scoped to the episode.
   */
  id: string;
  /** Client key — also the episode's URL slug for the sample data. */
  clientKey: string;
  episodeNo: string;
  episode: string;
  episodeMeta: string;
  lastTrained: string;
  /** Narrative voice profile shown in the right rail. */
  description: string;
  outputs: SampleOutput[];
  /**
   * Cached key moments from the generate pipeline (`server/ai/key-moments.ts`).
   * Drives the "Clip moments" panel on `/episodes/[id]`. Null/empty until
   * generation runs.
   */
  keyMoments?: KeyMoment[];
  /**
   * Phase 2.7 — pipeline state surfaced to the page so the
   * "Transcribing..." / "Importing..." / "Failed" panels can render
   * while the underlying Episode is mid-pipeline. Always populated for
   * live-mode episodes; left `undefined` in sample-data mode so the
   * panels never show there.
   */
  pipeline?: {
    /** Episode.source — drives which in-progress panel renders. */
    source: "PASTE" | "UPLOAD" | "RSS" | "YOUTUBE";
    /**
     * Fine-grained pipeline sub-state (Episode.stage). This is the
     * authoritative signal for panel selection — `pending` /
     * `importing` / `transcribing` / `generating` each map to a
     * distinct empty-state panel, `completed` and `failed` are the two
     * terminal states.
     *
     * The SSE stream at `/api/episodes/[id]/stream` emits stage deltas
     * so the client's local copy stays fresh without a full
     * `router.refresh()` per transition — which was the root cause of
     * the "stuck on transcribing" bug.
     */
    stage: "pending" | "importing" | "transcribing" | "generating" | "completed" | "failed";
    /**
     * Coarse Episode.status surfaced as a discriminator for the empty-
     * state UX. Kept alongside `stage` for backwards-compat with the
     * dashboard KPIs / list filtering. `failed` triggers the error
     * banner with the reason below.
     */
    status: "draft" | "processing" | "ready" | "archived" | "failed";
    /** Populated when stage === "failed" — short prose from the pipeline. */
    failureReason: string | null;
  };
};

const OUTPUT_META: Record<PlatformKey, string> = {
  x: "Thread · 6 posts",
  li: "Single post",
  ig: "Caption + tags",
  tt: "Script · ~25s",
  notes: "Summary + timestamps",
  blog: "Long-form draft",
  news: "Email issue",
};

function mk(
  rows: Array<Omit<SampleOutput, "key" | "id" | "meta" | "version" | "versionCount">>,
): SampleOutput[] {
  const keys: PlatformKey[] = ["x", "li", "ig", "tt", "notes", "blog", "news"];
  return rows.map((row, i) => ({
    key: keys[i],
    // Sample mode: action id == grid key. Live mode overrides with the real DB id.
    id: keys[i],
    meta: OUTPUT_META[keys[i]],
    version: 1,
    versionCount: 1,
    ...row,
  }));
}

const FF_KEY_MOMENTS: KeyMoment[] = [
  {
    topic: "Hires are source code",
    quote: "Your first ten hires don't fill roles — they write your culture's source code.",
    timestamp: "00:42",
    insight: "Reframes early hiring as architecture, not recruitment.",
  },
  {
    topic: "Hire for slope",
    quote: "Hire for slope, not intercept. Trajectory beats résumé.",
    timestamp: "06:18",
    insight: "A one-line interview rubric for early-stage teams.",
  },
  {
    topic: "First three set the bar",
    quote: "Your first 3 hires set a bar everyone else pattern-matches to.",
    timestamp: "11:40",
    insight: "Why hire #4 is the one that actually matters.",
  },
  {
    topic: "Culture-doc test",
    quote:
      "If you can't sit down today and write a one-page culture doc, you're not ready to make the next hire.",
    timestamp: "27:30",
    insight: "A practical readiness check before opening another req.",
  },
];

const TE_KEY_MOMENTS: KeyMoment[] = [
  {
    topic: "Fear becomes focus",
    quote: "Day 12 is when the fear stops being fear and starts being focus.",
    timestamp: "08:30",
    insight: "The mental shift that separates expedition from emergency.",
  },
  {
    topic: "Pack shrinks weekly",
    quote: "Your gear list shrinks every week. So does your sense of what you actually need.",
    timestamp: "21:15",
    insight: "Long trips redefine 'essential' in a way day-trips never can.",
  },
];

export const sampleEpisodes: Record<string, SampleEpisode> = {
  ff: {
    id: "ff",
    clientKey: "ff",
    episodeNo: "Episode 47",
    episode: "Why Your First 10 Hires Define Everything",
    episodeMeta: "with Dani Okafor · Recorded Jun 24, 2026 · 52 min",
    lastTrained: "2 days ago",
    description:
      "Direct and energetic with a builder's optimism. Short, punchy sentences. Opens on a contrarian hook, favors concrete numbers over abstractions, and always lands on one actionable takeaway. Warm but never fluffy — talks to founders like a peer who's been in the trenches.",
    keyMoments: FF_KEY_MOMENTS,
    outputs: mk([
      {
        status: "approved",
        quality: 92,
        content: `1/ Your first 10 hires don't fill roles. They write your culture's source code.

Dani Okafor scaled a team from 4 to 400 — and says the first ten decided all of it. 🧵

2/ Hires #1–3 set the bar. Everyone after pattern-matches to them. Get these wrong and you spend years debugging people decisions.

3/ Her rule: "Hire for slope, not intercept." Where someone is going beats where they are today.

4/ The trap nobody admits to: hiring people just like you. Your blind spots quietly become the company's blind spots — at scale.

5/ One takeaway: write the culture doc BEFORE hire #5. If you can't, you're not ready to make it.

Full episode below 👇`,
      },
      {
        status: "approved",
        quality: 88,
        content: `Most founders obsess over hire #100. The ones who win obsess over hire #4.

This week on The Founder's Frequency, Dani Okafor (4 → 400 employees) broke down why your first 10 hires aren't headcount — they're the source code your culture compiles from.

Three ideas that stuck with me:

• Hire for slope, not intercept. Trajectory beats résumé.
• Your first 3 hires set a bar everyone else pattern-matches to.
• If you can't write the culture doc, you're not ready to make the hire.

The uncomfortable part? Most of us hire people exactly like ourselves — and install our blind spots at scale.

What was your most important early hire, and what did it teach you? 👇`,
      },
      {
        status: "review",
        quality: 84,
        content: `Your first 10 hires = your culture's source code. 🧬

Dani Okafor went 4 → 400 and says the first ten decided everything.

Save this before your next hire 👇

— Hire for slope, not intercept
— Your first 3 set the bar
— Write the culture doc first

Full episode at the link in bio. 🎧

#startups #founders #hiring #companyculture #podcast`,
      },
      {
        status: "ready",
        quality: 79,
        content: `[HOOK — 0:00]
Your first 10 hires aren't employees. They're writing your company's source code.

[BEAT 1 — 0:03]
Dani Okafor scaled a team from 4 to 400. She says the first ten decided all of it.

[BEAT 2 — 0:09]
Rule one: hire for slope, not intercept. Where they're going beats where they are.

[BEAT 3 — 0:15]
The trap? Hiring people just like you — and scaling your own blind spots.

[CTA — 0:21]
Follow for the full breakdown. Episode link in bio.`,
      },
      {
        status: "review",
        quality: 90,
        content: `In this episode, Maya sits down with Dani Okafor (COO, scaled a team 4 → 400) on why the first 10 hires define a company.

Timestamps
00:00 — Cold open: hires as source code
04:12 — Hire for slope, not intercept
11:40 — The first-3 bar-setting effect
19:05 — Avoiding the clone trap
27:30 — The culture-doc test

Links
• Dani's culture-doc template
• The Founder's Frequency newsletter

Guest: Dani Okafor — @daniokafor`,
      },
      {
        status: "ready",
        quality: 86,
        content: `Why Your First 10 Hires Define Everything

There's a quiet moment in every company's life when it stops being a project and starts being an organization. According to Dani Okafor, who scaled her last team from four people to four hundred, that moment isn't a funding round or a launch. It's hire number ten.

"Your first ten hires don't fill roles," she told us. "They write the source code everything else compiles from."

In this piece we break down Okafor's framework for early hiring — hiring for slope over intercept, the bar-setting power of your first three, and the culture-doc test that tells you whether you're ready to grow at all…`,
      },
      {
        status: "ready",
        quality: 81,
        content: `Subject: Your first 10 hires are writing your source code

Hey —

This week Dani Okafor (4 → 400) made a case that stuck with me: the first ten people you hire don't fill roles, they define the company.

Three takeaways worth your inbox:

1. Hire for slope, not intercept.
2. Your first 3 hires set the bar everyone copies.
3. Can't write the culture doc? You're not ready to hire.

🎧 Listen to the full episode →

Until next week,
Maya`,
      },
    ]),
  },

  te: {
    id: "te",
    clientKey: "te",
    episodeNo: "Episode 23",
    episode: "Surviving 90 Days Off-Grid in Patagonia",
    episodeMeta: "Solo expedition log · Recorded Jun 18, 2026 · 47 min",
    lastTrained: "5 days ago",
    description:
      "Vivid and sensory with understated grit. Lets the landscape do the talking, leans on concrete detail over adjectives, and closes calm. Never sells the adventure — just reports it honestly and lets the reader feel the weight of the pack.",
    keyMoments: TE_KEY_MOMENTS,
    outputs: mk([
      {
        status: "review",
        quality: 84,
        content: `1/ 90 days off-grid in Patagonia. No resupply, no signal, no plan B.

Here's what the silence actually teaches you. 🧵

2/ Day 12 is when the fear stops being fear and starts being focus.

3/ Your gear list shrinks every week. So does your sense of what you actually need.`,
      },
      {
        status: "ready",
        quality: 80,
        content: `We spent 90 days off-grid in Patagonia for this episode of Trail & Error.

No resupply. No signal. Just weather, weight, and decisions.

The biggest lesson Sam brought back wasn't about gear — it was about how fast "essential" gets redefined when you carry everything on your back.`,
      },
      {
        status: "approved",
        quality: 86,
        content: `90 days. No resupply. Just Patagonia. 🏔️

What the wilderness teaches when the signal drops 👇

Full episode at the link in bio. 🎧

#backpacking #patagonia #offgrid #adventurepodcast`,
      },
      {
        status: "ready",
        quality: 74,
        content: `[HOOK]
90 days off-grid in Patagonia. No resupply.

[BEAT]
Day 12, the fear becomes focus.

[BEAT]
Every week the pack gets lighter — and so does your idea of "essential."

[CTA]
Full story, link in bio.`,
      },
      {
        status: "review",
        quality: 82,
        content: `Sam Rivera recounts 90 days off-grid in Patagonia.

Timestamps
00:00 — Why no resupply
08:30 — Day 12: fear to focus
21:15 — Redefining "essential"
34:00 — Coming back down

Guest: solo expedition`,
      },
      {
        status: "ready",
        quality: 78,
        content: `Surviving 90 Days Off-Grid in Patagonia

There's a specific kind of quiet you only find when the last bar of signal disappears. On this episode of Trail & Error, Sam Rivera walks us through ninety days of it — and what stayed with him long after the trail ended…`,
      },
      {
        status: "review",
        quality: 76,
        content: `Subject: 90 days, no resupply, no signal

Hey —

This week we went fully off-grid in Patagonia. The lesson that stuck: "essential" is a much shorter list than you think.

🎧 Listen →

Sam`,
      },
    ]),
  },

  mt: {
    id: "mt",
    clientKey: "mt",
    episodeNo: "Episode 12",
    episode: "The Index Fund Myth Everyone Repeats",
    episodeMeta: "Solo · Recorded Jun 20, 2026 · 39 min",
    lastTrained: "just connected",
    description:
      "Plain-spoken and skeptical, allergic to jargon. Reframes conventional wisdom with a sharp question, uses everyday analogies, and respects the listener's intelligence. Still calibrating — approve a few more outputs to lock in the voice.",
    outputs: mk([
      {
        status: "ready",
        quality: 71,
        content: `1/ "Just buy the index fund" is good advice wrapped around a myth.

Here's the part nobody finishes the sentence on. 🧵

2/ Index ≠ safe. Index = average. Those aren't the same word.`,
      },
      {
        status: "review",
        quality: 68,
        content: `"Just buy the index fund."

It's not wrong — but it's not the whole sentence. On Money on the Table this week, Priya breaks down what "passive" actually costs you, and when it stops being the obvious answer.`,
      },
      {
        status: "ready",
        quality: 73,
        content: `"Just buy the index fund" 📉

The part nobody finishes the sentence on 👇

Link in bio. 🎧

#personalfinance #investing #indexfunds #moneytips`,
      },
      {
        status: "ready",
        quality: 66,
        content: `[HOOK]
"Just buy the index fund" is half a sentence.

[BEAT]
Index doesn't mean safe. It means average.

[CTA]
The rest of the sentence — link in bio.`,
      },
      {
        status: "review",
        quality: 75,
        content: `Priya Anand unpacks the index fund myth.

Timestamps
00:00 — The half-sentence problem
06:40 — Index vs. safe
14:20 — When passive stops working

Guest: solo`,
      },
      {
        status: "ready",
        quality: 70,
        content: `The Index Fund Myth Everyone Repeats

"Just buy the index fund" might be the most repeated piece of financial advice of the decade. It's also incomplete — and the missing half is where most of the risk actually lives…`,
      },
      {
        status: "ready",
        quality: 64,
        content: `Subject: The index fund myth everyone repeats

Hey —

Index doesn't mean safe — it means average. This week we finish the sentence everyone starts.

🎧 Listen →

Priya`,
      },
    ]),
  },
};

export function getEpisode(clientKey: string): SampleEpisode | undefined {
  return sampleEpisodes[clientKey];
}
