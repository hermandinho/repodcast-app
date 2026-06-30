import { describe, expect, it } from "vitest";
import { parseDeepgramResponse } from "@/server/transcription/deepgram";

describe("parseDeepgramResponse", () => {
  it("returns the bare transcript when diarization isn't present", () => {
    const result = parseDeepgramResponse({
      metadata: { duration: 92.4, detected_language: "en" },
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript: "Welcome back to the show. Today we're talking about hiring.",
                words: [
                  { word: "welcome", start: 0, end: 0.4 },
                  { word: "back", start: 0.4, end: 0.6 },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(result.transcript).toBe("Welcome back to the show. Today we're talking about hiring.");
    expect(result.durationSec).toBe(92.4);
    expect(result.language).toBe("en");
  });

  it("renders speaker labels when diarization marks them", () => {
    const result = parseDeepgramResponse({
      metadata: { duration: 4 },
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript: "",
                words: [
                  { word: "welcome", start: 0, end: 0.4, speaker: 0, punctuated_word: "Welcome" },
                  { word: "back", start: 0.4, end: 0.6, speaker: 0, punctuated_word: "back." },
                  { word: "thanks", start: 1, end: 1.3, speaker: 1, punctuated_word: "Thanks" },
                  { word: "for", start: 1.3, end: 1.5, speaker: 1, punctuated_word: "for" },
                  {
                    word: "having",
                    start: 1.5,
                    end: 1.7,
                    speaker: 1,
                    punctuated_word: "having",
                  },
                  { word: "me", start: 1.7, end: 1.9, speaker: 1, punctuated_word: "me." },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(result.transcript).toBe("Speaker 1: Welcome back.\n\nSpeaker 2: Thanks for having me.");
  });

  it("returns empty results gracefully when Deepgram surfaces no channels", () => {
    const result = parseDeepgramResponse({});
    expect(result.transcript).toBe("");
    expect(result.durationSec).toBeNull();
    expect(result.language).toBeNull();
    expect(result.words).toEqual([]);
  });

  it("falls back to metadata.detected_language when the channel doesn't carry one", () => {
    const result = parseDeepgramResponse({
      metadata: { detected_language: "es" },
      results: {
        channels: [{ alternatives: [{ transcript: "Hola, ¿cómo estás?" }] }],
      },
    });
    expect(result.language).toBe("es");
    expect(result.transcript).toBe("Hola, ¿cómo estás?");
  });
});
