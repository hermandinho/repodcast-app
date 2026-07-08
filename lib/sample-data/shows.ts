import type { EpisodeStatus } from "./episode-status";
import type { PlatformKey } from "./platforms";

export type SampleEpisode = {
  /**
   * Real Episode.id when live (drives the row's link to /episodes/[id]).
   * Optional because the original sample-data fixtures don't carry one;
   * rows without an id render as a plain (un-linked) summary.
   */
  id?: string;
  title: string;
  date: string;
  status: EpisodeStatus;
  outputs: string;
  /** Total current-version outputs on this episode. `0` when generation
   *  hasn't run yet. */
  outputCount: number;
  /** Current-version outputs still waiting on internal review. `> 0`
   *  swaps the row's pill to "N to review" + accent Review CTA. */
  pendingReviewCount: number;
};

/**
 * Shape used everywhere in the UI to render a single podcast show. Includes
 * derived/aggregate fields (samples, episodeCount, avatarBg) so list views
 * don't have to do their own counting.
 */
export type SampleShow = {
  key: string;
  /** Parent customer's sample key — links the show back to a `SampleClient`. */
  clientKey: string;
  name: string;
  host: string;
  initial: string;
  avatarBg: string;
  /** Empty string when unset — UI falls back to the initials avatar on `avatarBg`. */
  artworkUrl: string;
  /**
   * Persisted RSS feed URL (Phase 2.8). `null` when no feed is connected
   * yet — the wizard's RSS picker treats that as "show the connect form".
   * Sample-data shows leave this `null`.
   */
  rssUrl?: string | null;
  samples: number;
  episodeCount: number;
  lastActivity: string;
  platformSamples: Record<PlatformKey, number>;
  episodes: SampleEpisode[];
  /**
   * Per-show voice-progress result — powers the sparkline + headline %
   * on the shows-list card. Optional so sample-data fixtures and shows
   * without any shipped outputs since edit tracking landed can omit it
   * (the card renders nothing then rather than a misleading empty
   * chart). Populated by `listShowsForUI` from a single batched Prisma
   * query grouped by showId (`listShippedOutputsForAgencyByShow`), so
   * per-show cards cost one query total, not N.
   */
  voiceProgress?: import("@/lib/voice-progress-shape").VoiceProgressResult;
};

export const sampleShows: SampleShow[] = [
  {
    key: "ff",
    clientKey: "northwind",
    name: "The Founder's Frequency",
    host: "Maya Chen",
    initial: "FF",
    avatarBg: "#3A5BA0",
    artworkUrl: "",
    samples: 18,
    episodeCount: 12,
    lastActivity: "2 days ago",
    platformSamples: { x: 21, li: 19, ig: 14, tt: 7, notes: 24, blog: 16, news: 9 },
    episodes: [
      {
        title: "Why Your First 10 Hires Define Everything",
        date: "Jun 24",
        status: "review",
        outputs: "7 outputs",
        outputCount: 7,
        pendingReviewCount: 5,
      },
      {
        title: "The Pricing Conversation You're Avoiding",
        date: "Jun 17",
        status: "approved",
        outputs: "7 outputs",
        outputCount: 7,
        pendingReviewCount: 0,
      },
      {
        title: "Hiring Your First Exec Without Regret",
        date: "Jun 10",
        status: "approved",
        outputs: "7 outputs",
        outputCount: 7,
        pendingReviewCount: 0,
      },
      {
        title: "Fundraising Is a Filter, Not a Finish Line",
        date: "Jun 3",
        status: "approved",
        outputs: "7 outputs",
        outputCount: 7,
        pendingReviewCount: 0,
      },
    ],
  },
  {
    key: "te",
    clientKey: "northwind",
    name: "Trail & Error",
    host: "Sam Rivera",
    initial: "TE",
    avatarBg: "#2E9E5B",
    artworkUrl: "",
    samples: 11,
    episodeCount: 8,
    lastActivity: "5 days ago",
    platformSamples: { x: 9, li: 12, ig: 8, tt: 4, notes: 14, blog: 10, news: 5 },
    episodes: [
      {
        title: "Surviving 90 Days Off-Grid in Patagonia",
        date: "Jun 18",
        status: "approved",
        outputs: "7 outputs",
        outputCount: 7,
        pendingReviewCount: 0,
      },
      {
        title: "Reading Weather Without a Phone",
        date: "Jun 11",
        status: "scheduled",
        outputs: "7 outputs",
        outputCount: 7,
        pendingReviewCount: 0,
      },
      {
        title: "The Gear That Didn't Make the Cut",
        date: "Jun 4",
        status: "approved",
        outputs: "7 outputs",
        outputCount: 7,
        pendingReviewCount: 0,
      },
    ],
  },
  {
    key: "mt",
    clientKey: "moneymatters",
    name: "Money on the Table",
    host: "Priya Anand",
    initial: "MT",
    avatarBg: "#7A4FB0",
    artworkUrl: "",
    samples: 4,
    episodeCount: 4,
    lastActivity: "today",
    platformSamples: { x: 3, li: 5, ig: 2, tt: 1, notes: 6, blog: 4, news: 2 },
    episodes: [
      {
        title: "The Index Fund Myth Everyone Repeats",
        date: "Jun 20",
        status: "generating",
        outputs: "5 / 7",
        outputCount: 5,
        pendingReviewCount: 0,
      },
      {
        title: 'What "Passive Income" Actually Costs',
        date: "Jun 13",
        status: "approved",
        outputs: "7 outputs",
        outputCount: 7,
        pendingReviewCount: 0,
      },
      {
        title: "Your Budget Is Lying to You",
        date: "Jun 6",
        status: "review",
        outputs: "7 outputs",
        outputCount: 7,
        pendingReviewCount: 3,
      },
    ],
  },
];

export function getShow(key: string): SampleShow | undefined {
  return sampleShows.find((s) => s.key === key);
}

export function totalEpisodes(): number {
  return sampleShows.reduce((sum, s) => sum + s.episodeCount, 0);
}
