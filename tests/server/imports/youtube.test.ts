import { describe, expect, it } from "vitest";
import {
  parseYouTubeVideoId,
  parseCaptionVtt,
  pickBestCaptionTrack,
  YouTubeImportError,
} from "@/server/imports/youtube";

describe("parseYouTubeVideoId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/watch?v=dQw4w9WgXcQ&list=abc", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=trk1", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"], // no scheme
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"], // bare id
  ])("extracts the video id from %s", (input, expected) => {
    expect(parseYouTubeVideoId(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "https://vimeo.com/12345",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/watch?v=short",
    "not a url at all",
    "https://www.youtube.com/results?search_query=test",
  ])("returns null for invalid input: %s", (input) => {
    expect(parseYouTubeVideoId(input)).toBeNull();
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseYouTubeVideoId("  https://youtu.be/dQw4w9WgXcQ  ")).toBe("dQw4w9WgXcQ");
  });
});

describe("parseCaptionVtt", () => {
  it("extracts cue text from a minimal WebVTT body", () => {
    const vtt = `WEBVTT
Kind: captions
Language: en

00:00:00.000 --> 00:00:02.000
Hello

00:00:02.000 --> 00:00:04.000
world`;
    expect(parseCaptionVtt(vtt)).toBe("Hello world");
  });

  it("strips numeric cue-id lines and NOTE blocks", () => {
    const vtt = `WEBVTT

NOTE some editor comment

1
00:00:00.000 --> 00:00:01.000
alpha

2
00:00:01.000 --> 00:00:02.000
beta`;
    expect(parseCaptionVtt(vtt)).toBe("alpha beta");
  });

  it("strips embedded timing tags like <00:00:03.360> and <c>...</c>", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:03.000
<00:00:00.500><c>hello</c><00:00:01.000><c> world</c>`;
    expect(parseCaptionVtt(vtt)).toBe("hello world");
  });

  it("de-dupes YouTube's auto-caption double-emission pattern", () => {
    // Auto-generated tracks often emit the same line twice: once as
    // plain text on cue N and once inside <c>...</c> tags on cue N+1.
    // After tag-strip, the two lines are identical — we should keep
    // only the first.
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
Welcome to the show

00:00:02.000 --> 00:00:04.000
<00:00:02.500><c>Welcome to the show</c>

00:00:04.000 --> 00:00:06.000
Today we are talking`;
    expect(parseCaptionVtt(vtt)).toBe("Welcome to the show Today we are talking");
  });

  it("collapses whitespace runs across concatenated cues", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:02.000
multi   line

00:00:02.000 --> 00:00:04.000
	tabby	text`;
    expect(parseCaptionVtt(vtt)).toBe("multi line tabby text");
  });

  it("returns empty string on a VTT with no cue text", () => {
    expect(parseCaptionVtt("WEBVTT\n\nKind: captions\n")).toBe("");
    expect(parseCaptionVtt("")).toBe("");
  });
});

describe("pickBestCaptionTrack", () => {
  it("returns null when no captions of either kind exist", () => {
    expect(pickBestCaptionTrack([], [])).toBeNull();
  });

  it("prefers manual English above all", () => {
    const track = pickBestCaptionTrack(["en", "es"], ["en"]);
    expect(track).toEqual({ languageCode: "en", name: "en", isGenerated: false });
  });

  it("prefers manual English over a manual non-English", () => {
    const track = pickBestCaptionTrack(["es", "en-US", "de"], ["en"]);
    expect(track?.languageCode).toBe("en-US");
    expect(track?.isGenerated).toBe(false);
  });

  it("falls back to any manual track when no English manual exists", () => {
    const track = pickBestCaptionTrack(["es", "de"], ["en"]);
    expect(track?.languageCode).toBe("es");
    expect(track?.isGenerated).toBe(false);
  });

  it("uses auto English when no manual tracks exist", () => {
    const track = pickBestCaptionTrack([], ["fr", "en"]);
    expect(track?.languageCode).toBe("en");
    expect(track?.isGenerated).toBe(true);
  });

  it("uses the first auto track when nothing else matches", () => {
    const track = pickBestCaptionTrack([], ["fr"]);
    expect(track?.languageCode).toBe("fr");
    expect(track?.isGenerated).toBe(true);
  });
});

describe("YouTubeImportError", () => {
  it("carries a machine-readable code + optional stderr", () => {
    const err = new YouTubeImportError("not_found", "boom", "video unavailable");
    expect(err.code).toBe("not_found");
    expect(err.stderr).toBe("video unavailable");
    expect(err.name).toBe("YouTubeImportError");
    expect(err instanceof Error).toBe(true);
  });

  it("stores stderr as undefined when not provided", () => {
    const err = new YouTubeImportError("invalid_url", "bad URL");
    expect(err.stderr).toBeUndefined();
  });
});
