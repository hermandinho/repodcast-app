/**
 * Q2 wk15 — public sample delivery registry.
 *
 * One entry per `/samples/[slug]` marketing page. The data is hardcoded
 * (not DB-sourced) so the page can be statically pre-rendered at build
 * time and cold-traffic latency stays flat. When we curate >5 samples,
 * migrate this to a `PublicSample` model + a `/root/samples` admin.
 *
 * Sample content is pulled from `lib/sample-data/` — the same fixtures
 * that power the app's sample-data mode — so the marketing surface
 * shows the same voice-matched outputs a signed-in user would see when
 * they try the app with sample data.
 */

import { sampleEpisodes, type SampleOutput } from "@/lib/sample-data/episode-outputs";
import type { PlatformKey } from "@/lib/sample-data/platforms";
import { sampleShows, type SampleShow } from "@/lib/sample-data/shows";
import { voiceProfiles, type VoiceProfile } from "@/lib/sample-data/voice-profiles";

/**
 * Minimal per-clip / per-artwork / per-audiogram metadata rendered as
 * representative tiles on the samples page. Marketing-only shapes — do
 * NOT try to reuse these as VideoClip / Artwork DTOs. The values are
 * hand-picked illustrations of what a real render looks like, not
 * pointers to actual R2 assets. See the "sample media" disclosure on
 * the samples page.
 */
export type SampleClipTile = {
  hookLine: string;
  spanSeconds: number;
  score: number;
  /** Which quote from the episode inspired the clip. */
  quote: string;
};

export type SampleArtworkAspect = "16:9" | "1:1" | "9:16";

export type SampleArtworkTile = {
  aspect: SampleArtworkAspect;
  concept: string;
};

export type SampleAudiogramTile = {
  platform: PlatformKey;
  captionPreview: string;
  spanSeconds: number;
};

export type SampleDelivery = {
  slug: string;
  /** Show key from `lib/sample-data/shows.ts`. */
  showKey: string;
  /**
   * Explanatory subtitle for the samples header — one sentence naming
   * what a visitor is looking at. Not the episode's own description.
   */
  tagline: string;
  clips: SampleClipTile[];
  artwork: SampleArtworkTile[];
  audiograms: SampleAudiogramTile[];
};

/**
 * Slug → sample metadata. `/samples/founders-frequency` is the only
 * curated slug for now; the marketing hero links here.
 */
export const SAMPLE_REGISTRY: Record<string, SampleDelivery> = {
  "founders-frequency": {
    slug: "founders-frequency",
    showKey: "ff",
    tagline:
      "One 52-minute episode. Seven platform posts, three vertical clips, hero artwork, and audiograms — every deliverable in the host's actual voice.",
    clips: [
      {
        hookLine: "Your first 10 hires don't fill roles — they write your culture's source code.",
        spanSeconds: 42,
        score: 0.94,
        quote: "Hires #1–3 set the bar. Everyone after pattern-matches to them.",
      },
      {
        hookLine: "Hire for slope, not intercept.",
        spanSeconds: 38,
        score: 0.91,
        quote: "Where someone is going beats where they are today.",
      },
      {
        hookLine: "You install your blind spots at scale.",
        spanSeconds: 51,
        score: 0.88,
        quote:
          "The trap nobody admits to: hiring people just like you. Your blind spots quietly become the company's blind spots.",
      },
    ],
    artwork: [
      {
        aspect: "16:9",
        concept:
          "A hand-drawn schematic of a company org chart annotated like source code — variable-name callouts, syntax-highlighted node labels, warm amber accents on a navy backdrop.",
      },
      {
        aspect: "1:1",
        concept:
          "Bold typographic cover — the phrase 'HIRE FOR SLOPE' set in a heavy display cut, tight negative space, amber underline stroking through the second word.",
      },
      {
        aspect: "9:16",
        concept:
          "Vertical stack of three portrait frames — hires 1, 2, 3 — each with a subtle numeric overlay and a hand-set caption. Reads top-to-bottom like a comic-strip escalation.",
      },
    ],
    audiograms: [
      {
        platform: "x",
        captionPreview:
          "Your first 10 hires don't fill roles. They write your culture's source code.",
        spanSeconds: 42,
      },
      {
        platform: "li",
        captionPreview:
          "Most founders obsess over hire #100. The ones who win obsess over hire #4.",
        spanSeconds: 47,
      },
      {
        platform: "ig",
        captionPreview: "Save this before your next hire. Hire for slope, not intercept.",
        spanSeconds: 39,
      },
    ],
  },
};

/**
 * Public list of all curated slugs. Used by the samples index (future)
 * and by `generateStaticParams` in the samples route.
 */
export function listSampleSlugs(): string[] {
  return Object.keys(SAMPLE_REGISTRY);
}

/**
 * Resolved sample data — merges the registry entry with the source
 * fixtures so the page component receives a single ready-to-render
 * object. Returns null when the slug isn't in the registry.
 */
export type ResolvedSample = {
  slug: string;
  tagline: string;
  show: SampleShow;
  voice: VoiceProfile;
  episodeTitle: string;
  episodeMeta: string;
  episodeDescription: string | null;
  outputs: SampleOutput[];
  clips: SampleClipTile[];
  artwork: SampleArtworkTile[];
  audiograms: SampleAudiogramTile[];
};

export function resolveSample(slug: string): ResolvedSample | null {
  const entry = SAMPLE_REGISTRY[slug];
  if (!entry) return null;

  const show = sampleShows.find((s) => s.key === entry.showKey);
  const voice = voiceProfiles[entry.showKey];
  const episode = sampleEpisodes[entry.showKey];
  if (!show || !voice || !episode) return null;

  return {
    slug: entry.slug,
    tagline: entry.tagline,
    show,
    voice,
    episodeTitle: episode.episode,
    episodeMeta: episode.episodeMeta,
    episodeDescription: episode.description ?? null,
    outputs: episode.outputs,
    clips: entry.clips,
    artwork: entry.artwork,
    audiograms: entry.audiograms,
  };
}
