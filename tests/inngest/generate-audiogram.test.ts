import { describe, expect, it } from "vitest";
import { pickAudiogramBackground } from "@/inngest/functions/generate-audiogram";

const EPISODE_VERTICAL = "https://cdn/episode-vertical.png";
const EPISODE_SQUARE = "https://cdn/episode-square.png";
const EPISODE_HERO = "https://cdn/episode-hero.png";
const SHOW_ARTWORK = "https://cdn/show-artwork.png";

describe("pickAudiogramBackground", () => {
  it("prefers vertical episode art for 9:16 audiograms", () => {
    const url = pickAudiogramBackground("9:16", {
      episodeSquareCoverUrl: EPISODE_SQUARE,
      episodeVerticalCoverUrl: EPISODE_VERTICAL,
      episodeHeroImageUrl: EPISODE_HERO,
      showArtworkUrl: SHOW_ARTWORK,
    });
    expect(url).toBe(EPISODE_VERTICAL);
  });

  it("prefers square episode art for 1:1 audiograms", () => {
    const url = pickAudiogramBackground("1:1", {
      episodeSquareCoverUrl: EPISODE_SQUARE,
      episodeVerticalCoverUrl: EPISODE_VERTICAL,
      episodeHeroImageUrl: EPISODE_HERO,
      showArtworkUrl: SHOW_ARTWORK,
    });
    expect(url).toBe(EPISODE_SQUARE);
  });

  it("falls back to hero when the aspect-matched variant is missing (9:16)", () => {
    const url = pickAudiogramBackground("9:16", {
      episodeSquareCoverUrl: EPISODE_SQUARE,
      episodeVerticalCoverUrl: null,
      episodeHeroImageUrl: EPISODE_HERO,
      showArtworkUrl: SHOW_ARTWORK,
    });
    expect(url).toBe(EPISODE_HERO);
  });

  it("falls back to hero when the aspect-matched variant is missing (1:1)", () => {
    const url = pickAudiogramBackground("1:1", {
      episodeSquareCoverUrl: null,
      episodeVerticalCoverUrl: EPISODE_VERTICAL,
      episodeHeroImageUrl: EPISODE_HERO,
      showArtworkUrl: SHOW_ARTWORK,
    });
    expect(url).toBe(EPISODE_HERO);
  });

  it("falls back to the other episode aspect before reaching show artwork", () => {
    const url = pickAudiogramBackground("9:16", {
      episodeSquareCoverUrl: EPISODE_SQUARE,
      episodeVerticalCoverUrl: null,
      episodeHeroImageUrl: null,
      showArtworkUrl: SHOW_ARTWORK,
    });
    expect(url).toBe(EPISODE_SQUARE);
  });

  it("falls back to show artwork when no episode art exists", () => {
    const url = pickAudiogramBackground("9:16", {
      episodeSquareCoverUrl: null,
      episodeVerticalCoverUrl: null,
      episodeHeroImageUrl: null,
      showArtworkUrl: SHOW_ARTWORK,
    });
    expect(url).toBe(SHOW_ARTWORK);
  });

  it("returns null when every candidate is missing — worker paints the gradient", () => {
    const url = pickAudiogramBackground("9:16", {
      episodeSquareCoverUrl: null,
      episodeVerticalCoverUrl: null,
      episodeHeroImageUrl: null,
      showArtworkUrl: null,
    });
    expect(url).toBeNull();
  });

  it("treats empty and whitespace-only strings as missing", () => {
    const url = pickAudiogramBackground("9:16", {
      episodeSquareCoverUrl: "",
      episodeVerticalCoverUrl: "   ",
      episodeHeroImageUrl: EPISODE_HERO,
      showArtworkUrl: SHOW_ARTWORK,
    });
    expect(url).toBe(EPISODE_HERO);
  });
});
