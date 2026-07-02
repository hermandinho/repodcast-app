import { describe, expect, it } from "vitest";
import {
  parseYouTubeVideoId,
  parseCaptionXml,
  pickBestCaptionTrack,
  YouTubeImportError,
  type YouTubeCaptionTrack,
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

describe("parseCaptionXml", () => {
  it("concatenates <text> nodes in order with a single space between them", () => {
    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<transcript>
<text start="0" dur="2">Hello</text>
<text start="2" dur="2">world</text>
</transcript>`;
    expect(parseCaptionXml(xml)).toBe("Hello world");
  });

  it("decodes common HTML entities", () => {
    const xml = `<text start="0">it&#39;s &amp; &quot;there&quot;</text>`;
    expect(parseCaptionXml(xml)).toBe(`it's & "there"`);
  });

  it("collapses whitespace runs", () => {
    const xml = `<text start="0">multi\n\nline\t\ttext</text>`;
    expect(parseCaptionXml(xml)).toBe("multi line text");
  });

  it("returns empty string on a transcript with no text nodes", () => {
    expect(parseCaptionXml(`<transcript></transcript>`)).toBe("");
    expect(parseCaptionXml(``)).toBe("");
  });

  it("handles attribute variants (start, dur, attrs in any order)", () => {
    const xml = `
<text dur="1" start="0">alpha</text>
<text start="1"  dur="2">beta</text>
<text>gamma</text>`;
    expect(parseCaptionXml(xml)).toBe("alpha beta gamma");
  });
});

describe("pickBestCaptionTrack", () => {
  const en: YouTubeCaptionTrack = {
    languageCode: "en",
    name: "English",
    isGenerated: false,
    baseUrl: "http://en",
  };
  const enAuto: YouTubeCaptionTrack = {
    languageCode: "en",
    name: "English (auto-generated)",
    isGenerated: true,
    baseUrl: "http://enauto",
  };
  const es: YouTubeCaptionTrack = {
    languageCode: "es",
    name: "Español",
    isGenerated: false,
    baseUrl: "http://es",
  };
  const frAuto: YouTubeCaptionTrack = {
    languageCode: "fr",
    name: "Français (auto)",
    isGenerated: true,
    baseUrl: "http://frauto",
  };

  it("returns null for an empty list", () => {
    expect(pickBestCaptionTrack([])).toBeNull();
  });

  it("prefers manual English above all", () => {
    expect(pickBestCaptionTrack([enAuto, es, en])).toBe(en);
  });

  it("falls back to any manual track when no English manual", () => {
    expect(pickBestCaptionTrack([enAuto, es, frAuto])).toBe(es);
  });

  it("uses auto English when no manual tracks exist", () => {
    expect(pickBestCaptionTrack([frAuto, enAuto])).toBe(enAuto);
  });

  it("uses the first auto track when nothing else matches", () => {
    expect(pickBestCaptionTrack([frAuto])).toBe(frAuto);
  });
});

describe("YouTubeImportError", () => {
  it("carries a machine-readable code + optional http status", () => {
    const err = new YouTubeImportError("not_found", "boom", 404);
    expect(err.code).toBe("not_found");
    expect(err.status).toBe(404);
    expect(err.name).toBe("YouTubeImportError");
    expect(err instanceof Error).toBe(true);
  });
});
