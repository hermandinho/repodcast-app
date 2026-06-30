import { describe, expect, it } from "vitest";
import { normaliseTranscript } from "@/server/imports/transcripts";

describe("normaliseTranscript", () => {
  it("strips VTT cue timing + WEBVTT header, keeps speaker labels and paragraph breaks", () => {
    const vtt = [
      "WEBVTT",
      "",
      "1",
      "00:00:00.000 --> 00:00:03.500",
      "<v Maya>Welcome back to the show.",
      "",
      "2",
      "00:00:03.600 --> 00:00:06.000",
      "<v Dani>Thanks for having me, Maya.",
      "",
    ].join("\n");

    expect(normaliseTranscript(vtt, "text/vtt", "https://x/a.vtt")).toBe(
      "Maya: Welcome back to the show.\n\nDani: Thanks for having me, Maya.",
    );
  });

  it("strips SRT timing lines + ordinal numbers", () => {
    const srt = [
      "1",
      "00:00:00,000 --> 00:00:02,000",
      "Welcome back.",
      "",
      "2",
      "00:00:02,500 --> 00:00:05,000",
      "Today we're talking about hiring.",
      "",
    ].join("\n");

    expect(normaliseTranscript(srt, "application/srt", "https://x/a.srt")).toBe(
      "Welcome back.\n\nToday we're talking about hiring.",
    );
  });

  it("flattens a JSON transcript with speaker turns into `Speaker: text` lines", () => {
    const json = JSON.stringify({
      version: "1.0.0",
      segments: [
        { speaker: "Maya", startTime: 0, endTime: 3.5, body: "Welcome back." },
        { speaker: "Maya", startTime: 3.5, endTime: 5, body: "Today we have Dani." },
        { speaker: "Dani", startTime: 5, endTime: 7, body: "Thanks for having me." },
      ],
    });

    expect(normaliseTranscript(json, "application/json", "https://x/a.json")).toBe(
      "Maya: Welcome back. Today we have Dani.\n\nDani: Thanks for having me.",
    );
  });

  it("handles JSON segments without speaker fields (no prefix)", () => {
    const json = JSON.stringify({
      segments: [{ body: "First line." }, { body: "Second line." }],
    });
    expect(normaliseTranscript(json, "application/json", "https://x/a.json")).toBe(
      "First line. Second line.",
    );
  });

  it("falls back to raw body when JSON fails to parse", () => {
    const malformed = '{ "segments": [{ "body": "broken" ';
    expect(normaliseTranscript(malformed, "application/json", "https://x/a.json")).toBe(
      malformed.trim(),
    );
  });

  it("strips HTML tags + decodes the common entities", () => {
    const html = "<p>Welcome &amp; thanks.</p><p>Today's topic: <strong>hiring</strong>.</p>";
    expect(normaliseTranscript(html, "text/html", "https://x/a.html")).toBe(
      "Welcome & thanks.\n\nToday's topic: hiring.",
    );
  });

  it("falls through to plain text when no format hint matches", () => {
    expect(normaliseTranscript("Hello world.\nLine two.   ", "", "https://x/a.unknown")).toBe(
      "Hello world.\nLine two.",
    );
  });

  it("uses the URL extension when content-type is missing", () => {
    const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello.\n";
    expect(normaliseTranscript(vtt, "", "https://cdn.example.com/feed/ep1.vtt")).toBe("Hello.");
  });
});
