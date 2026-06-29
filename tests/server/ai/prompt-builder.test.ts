import { describe, expect, it } from "vitest";
import { Platform } from "@prisma/client";
import {
  buildMessages,
  selectSamples,
  type VoiceContext,
  type VoiceSampleForPrompt,
} from "@/server/ai/prompt-builder";
import { ALL_PLATFORMS } from "@/server/ai/platforms";

const voice: VoiceContext = {
  clientName: "The Founder's Frequency",
  hostName: "Maya Chen",
  voiceDescription: "Direct and energetic with a builder's optimism. Short, punchy sentences.",
  globalInstructions: "Always open with a contrarian hook. Keep sentences short.",
  perPlatformInstructions: {
    TWITTER: "Lead tweet hooks in under 200 chars. 5–7 tweets max.",
    LINKEDIN: "No hashtags. Close with one question to the reader.",
  },
  samples: [
    { platform: Platform.TWITTER, content: "Sample tweet 1: contrarian hook." },
    { platform: Platform.TWITTER, content: "Sample tweet 2: another idea." },
    { platform: Platform.LINKEDIN, content: "Sample LinkedIn 1: peer-to-peer reflection." },
    { platform: Platform.BLOG, content: "Sample blog 1: scene opening." },
  ],
};

const TRANSCRIPT = "Maya: This is the transcript body. ".repeat(20);
const MODEL = "claude-sonnet-4-6";

describe("selectSamples", () => {
  it("prefers on-platform samples first", () => {
    const picked = selectSamples(voice.samples, Platform.TWITTER, {
      targetCount: 2,
      maxTotal: 4,
    });
    // First two should be TWITTER.
    expect(picked.slice(0, 2).every((s) => s.platform === Platform.TWITTER)).toBe(true);
  });

  it("tops up with off-platform samples to maxTotal", () => {
    const picked = selectSamples(voice.samples, Platform.INSTAGRAM, {
      targetCount: 3,
      maxTotal: 3,
    });
    // No INSTAGRAM samples available — everything is off-platform.
    expect(picked).toHaveLength(3);
    expect(picked.every((s) => s.platform !== Platform.INSTAGRAM)).toBe(true);
  });

  it("caps at maxTotal even when there's plenty on-platform", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      platform: Platform.TWITTER,
      content: `s${i}`,
    }));
    expect(selectSamples(many, Platform.TWITTER, { targetCount: 3, maxTotal: 5 })).toHaveLength(5);
  });

  it("v2 scoring: length-fit boosts an older on-target sample over a fresh tiny one", () => {
    // Production calls pass 20 newest-first samples; per-step recency decay
    // is gentle in that regime (~0.04 between adjacent indices) so length-
    // fit (range 0.3–1.0) can flip a pick. The newest LinkedIn is tiny
    // (drops length-fit to the 0.3 floor); index 5 is in the 700–1,400
    // char sweet spot. Expect: idx 5 wins.
    const tooShort = "y".repeat(50);
    const sweetSpot = "x".repeat(900);
    const samples: VoiceSampleForPrompt[] = Array.from({ length: 20 }, (_, i) => ({
      platform: Platform.LINKEDIN,
      content: i === 5 ? sweetSpot : tooShort,
    }));
    const picked = selectSamples(samples, Platform.LINKEDIN, {
      targetCount: 1,
      maxTotal: 1,
    });
    expect(picked).toHaveLength(1);
    expect(picked[0].content).toBe(sweetSpot);
  });

  it("v2 scoring: when length-fit ties, recency wins", () => {
    // All 20 LinkedIn samples inside the sweet spot → length-fit tied. The
    // newest (index 0) should come out first.
    const samples: VoiceSampleForPrompt[] = Array.from({ length: 20 }, (_, i) => ({
      platform: Platform.LINKEDIN,
      content: `${String.fromCharCode(65 + i)}`.repeat(900),
    }));
    const picked = selectSamples(samples, Platform.LINKEDIN, {
      targetCount: 2,
      maxTotal: 2,
    });
    expect(picked.map((s) => s.content)).toEqual([samples[0].content, samples[1].content]);
  });

  it("v2 scoring: off-platform samples are scored against their own platform's sweet spot", () => {
    // Target is BLOG; the picker tops up with off-platform samples. The two
    // off-platform candidates sit at similar recency positions in a
    // realistic batch — the LinkedIn (inside its own platform's sweet
    // spot) should beat the too-short TWITTER thread for the off-platform
    // slot, confirming scoring uses each sample's own platform, not the
    // target's.
    const samples: VoiceSampleForPrompt[] = [
      ...Array.from({ length: 10 }, () => ({
        platform: Platform.BLOG,
        content: "B".repeat(5000),
      })),
      { platform: Platform.TWITTER, content: "t".repeat(100) }, // below TWITTER sweet spot
      { platform: Platform.LINKEDIN, content: "L".repeat(900) }, // inside LINKEDIN sweet spot
    ];
    const picked = selectSamples(samples, Platform.BLOG, {
      targetCount: 0,
      maxTotal: 1,
    });
    expect(picked).toHaveLength(1);
    expect(picked[0].platform).toBe(Platform.LINKEDIN);
  });

  it("v2 scoring: empty input returns empty array", () => {
    expect(selectSamples([], Platform.TWITTER)).toEqual([]);
  });
});

describe("buildMessages", () => {
  it("produces a system array with cache_control on the stable blocks", () => {
    const prompt = buildMessages({
      platform: Platform.TWITTER,
      voice,
      transcript: TRANSCRIPT,
      model: MODEL,
    });
    expect(prompt.model).toBe(MODEL);
    expect(prompt.maxTokens).toBeGreaterThan(0);
    expect(Array.isArray(prompt.system)).toBe(true);
    const system = prompt.system as Array<{ type: string; text: string; cache_control?: unknown }>;
    // Identity + samples + global = 3 cacheable blocks; platform-specific = 1 non-cached.
    const cacheable = system.filter((b) => b.cache_control);
    expect(cacheable.length).toBeGreaterThanOrEqual(2);
    // The final block (platform-specific) should NOT be marked ephemeral.
    expect(system[system.length - 1].cache_control).toBeUndefined();
  });

  it("includes voice description + global instructions in the system blocks", () => {
    const prompt = buildMessages({
      platform: Platform.TWITTER,
      voice,
      transcript: TRANSCRIPT,
      model: MODEL,
    });
    const joined = (prompt.system as Array<{ text: string }>).map((b) => b.text).join("\n");
    expect(joined).toContain("Maya Chen");
    expect(joined).toContain("Direct and energetic");
    expect(joined).toContain("contrarian hook");
  });

  it("injects per-platform rule for the target platform only", () => {
    const twitter = buildMessages({
      platform: Platform.TWITTER,
      voice,
      transcript: TRANSCRIPT,
      model: MODEL,
    });
    const linkedin = buildMessages({
      platform: Platform.LINKEDIN,
      voice,
      transcript: TRANSCRIPT,
      model: MODEL,
    });
    const twitterText = (twitter.system as Array<{ text: string }>).map((b) => b.text).join("\n");
    const linkedinText = (linkedin.system as Array<{ text: string }>).map((b) => b.text).join("\n");
    // Each platform's specific rule appears, prefixed with "Additional rule for X:".
    expect(twitterText).toContain("Additional rule for TWITTER");
    expect(twitterText).toContain("under 200 chars");
    expect(linkedinText).toContain("Additional rule for LINKEDIN");
    expect(linkedinText).toContain("Close with one question to the reader");
    // The OTHER platform's per-client rule never leaks into this prompt.
    expect(twitterText).not.toContain("Close with one question to the reader");
    expect(linkedinText).not.toContain("Lead tweet hooks");
  });

  it("user message contains the transcript", () => {
    const prompt = buildMessages({
      platform: Platform.BLOG,
      voice,
      transcript: TRANSCRIPT,
      model: MODEL,
    });
    const userContent = prompt.messages[0].content;
    const userText =
      typeof userContent === "string"
        ? userContent
        : (userContent as Array<{ type: string; text: string }>)[0].text;
    expect(userText).toContain(TRANSCRIPT.slice(0, 50));
    expect(userText).toContain("Blog Post");
  });

  it("each platform compiles to a non-empty prompt", () => {
    for (const platform of ALL_PLATFORMS) {
      const prompt = buildMessages({ platform, voice, transcript: TRANSCRIPT, model: MODEL });
      expect((prompt.system as unknown[]).length).toBeGreaterThan(0);
      expect(prompt.messages.length).toBe(1);
    }
  });

  it("works with no samples + no instructions (minimal voice profile)", () => {
    const sparse: VoiceContext = {
      clientName: "Brand New Show",
      hostName: "Jane Doe",
      voiceDescription: null,
      globalInstructions: null,
      perPlatformInstructions: {},
      samples: [],
    };
    const prompt = buildMessages({
      platform: Platform.TWITTER,
      voice: sparse,
      transcript: TRANSCRIPT,
      model: MODEL,
    });
    const text = (prompt.system as Array<{ text: string }>).map((b) => b.text).join("\n");
    expect(text).toContain("Jane Doe");
    expect(text).toContain("Brand New Show");
  });
});
