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

  it("v3 scoring: a heavily edited fresh sample loses to a clean older one", () => {
    // Both LINKEDIN, both inside the length sweet spot, so length-fit
    // ties. The newer sample (index 0) was rewritten top-to-bottom —
    // editFit drops to the 0.2 floor, multiplying its whole score by 0.2.
    // The older sample (index 1) shipped untouched, so its recency-decayed
    // score isn't multiplied down. Clean older wins.
    const sweetSpot = "x".repeat(900);
    const samples: VoiceSampleForPrompt[] = [
      { platform: Platform.LINKEDIN, content: sweetSpot, editDistance: 2000 }, // fresh, rewritten
      { platform: Platform.LINKEDIN, content: sweetSpot, editDistance: 0 }, // older, untouched
    ];
    const picked = selectSamples(samples, Platform.LINKEDIN, {
      targetCount: 1,
      maxTotal: 1,
    });
    expect(picked).toHaveLength(1);
    expect(picked[0].editDistance).toBe(0);
  });

  it("v3 diversity: off-platform slots round-robin across distinct platforms", () => {
    // Show has 10 TWITTER approvals, 1 LINKEDIN, 1 BLOG. Target is
    // INSTAGRAM (no on-platform samples) with 3 off-platform slots. The
    // pre-diversity picker would fill all 3 with the highest-scoring
    // TWITTERs; diversify should spread across all three platforms first.
    const sweetTwitter = "t".repeat(1200);
    const sweetLinkedin = "l".repeat(900);
    const sweetBlog = "b".repeat(5000);
    const samples: VoiceSampleForPrompt[] = [
      ...Array.from({ length: 10 }, () => ({
        platform: Platform.TWITTER,
        content: sweetTwitter,
      })),
      { platform: Platform.LINKEDIN, content: sweetLinkedin },
      { platform: Platform.BLOG, content: sweetBlog },
    ];
    const picked = selectSamples(samples, Platform.INSTAGRAM, {
      targetCount: 0,
      maxTotal: 3,
    });
    const platforms = new Set(picked.map((s) => s.platform));
    expect(picked).toHaveLength(3);
    expect(platforms.has(Platform.TWITTER)).toBe(true);
    expect(platforms.has(Platform.LINKEDIN)).toBe(true);
    expect(platforms.has(Platform.BLOG)).toBe(true);
  });

  it("v3 diversity: rotates back to the highest-signal platform once each is served", () => {
    // 3 slots to fill, 2 platforms available. Round 0 picks one of each;
    // round 1 falls back to the highest-scoring platform (TWITTER, since
    // its bucket is bigger and the top score is set by recency-in-input).
    const sweetTwitter = "t".repeat(1200);
    const sweetLinkedin = "l".repeat(900);
    const samples: VoiceSampleForPrompt[] = [
      { platform: Platform.TWITTER, content: sweetTwitter },
      { platform: Platform.TWITTER, content: sweetTwitter },
      { platform: Platform.LINKEDIN, content: sweetLinkedin },
    ];
    const picked = selectSamples(samples, Platform.INSTAGRAM, {
      targetCount: 0,
      maxTotal: 3,
    });
    const twitterCount = picked.filter((s) => s.platform === Platform.TWITTER).length;
    const linkedinCount = picked.filter((s) => s.platform === Platform.LINKEDIN).length;
    expect(picked).toHaveLength(3);
    expect(twitterCount).toBe(2);
    expect(linkedinCount).toBe(1);
  });

  it("v3 scoring: missing editDistance is treated as untouched (no regression for legacy samples)", () => {
    // A newer sample with no editDistance recorded should not be
    // downgraded — otherwise pre-tracking approvals would silently lose
    // ranking. With everything else equal (length in-range), newest wins.
    const sweetSpot = "x".repeat(900);
    const samples: VoiceSampleForPrompt[] = [
      { platform: Platform.LINKEDIN, content: sweetSpot }, // no editDistance
      { platform: Platform.LINKEDIN, content: sweetSpot, editDistance: 0 },
    ];
    const picked = selectSamples(samples, Platform.LINKEDIN, {
      targetCount: 1,
      maxTotal: 1,
    });
    expect(picked).toHaveLength(1);
    expect(picked[0].editDistance).toBeUndefined();
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
    // Identity + samples + global + transcript = up to 4 cacheable blocks;
    // platform-specific = 1 non-cached.
    const cacheable = system.filter((b) => b.cache_control);
    expect(cacheable.length).toBeGreaterThanOrEqual(3);
    // Anthropic caps cache_control breakpoints at 4 per request.
    expect(cacheable.length).toBeLessThanOrEqual(4);
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
    // Each platform's specific rule appears as an override that beats sample style.
    expect(twitterText).toContain("Non-negotiable rule for TWITTER");
    expect(twitterText).toContain("under 200 chars");
    expect(linkedinText).toContain("Non-negotiable rule for LINKEDIN");
    expect(linkedinText).toContain("Close with one question to the reader");
    // The OTHER platform's per-client rule never leaks into this prompt.
    expect(twitterText).not.toContain("Close with one question to the reader");
    expect(linkedinText).not.toContain("Lead tweet hooks");
  });

  it("per-platform rule claims precedence over the platform guidance above it", () => {
    // Regression guard for the emoji bug: the Twitter platform prompt bans
    // emoji ("No emoji except a single 🧵…"). A custom per-platform rule
    // like "Add a thank you emoji at the start" was being ignored because
    // the override wording only claimed to beat voice-matching + sample
    // style — leaving the model to defer to the platform ban. The wording
    // must explicitly state precedence over the platform guidance above.
    const withEmojiRule: VoiceContext = {
      ...voice,
      perPlatformInstructions: {
        TWITTER: "Add a thank you emoji at the start of each message.",
      },
    };
    const prompt = buildMessages({
      platform: Platform.TWITTER,
      voice: withEmojiRule,
      transcript: TRANSCRIPT,
      model: MODEL,
    });
    const blocks = prompt.system as Array<{ text: string }>;
    // The rule + the platform guidance land in the SAME (last) system block
    // by construction — the wording is only meaningful when the model can
    // see both together.
    const platformBlock = blocks[blocks.length - 1].text;
    expect(platformBlock).toContain("No emoji"); // platform prompt still present
    expect(platformBlock).toMatch(
      /overrides voice-matching, sample style, AND the platform guidance above/,
    );
    // Precedence is meaningful only when the custom rule lands AFTER the
    // platform guidance the model is being told to disregard.
    const platformGuidanceIdx = platformBlock.indexOf("No emoji");
    const customRuleIdx = platformBlock.indexOf("Add a thank you emoji");
    expect(customRuleIdx).toBeGreaterThan(platformGuidanceIdx);
  });

  it("transcript lives in a cached system block; user message is the ask only", () => {
    // The transcript is the largest payload and it's stable across the N
    // parallel platform calls of the same episode — pinning it into a
    // cached system block lets the sibling calls read Anthropic's
    // ephemeral cache instead of re-processing the whole transcript from
    // scratch. The user message stays short so it doesn't get retokenised
    // for the cache prefix.
    const prompt = buildMessages({
      platform: Platform.BLOG,
      voice,
      transcript: TRANSCRIPT,
      model: MODEL,
    });
    const system = prompt.system as Array<{ text: string; cache_control?: unknown }>;
    const transcriptBlock = system.find((b) => b.text.includes(TRANSCRIPT.slice(0, 50)));
    expect(transcriptBlock).toBeDefined();
    expect(transcriptBlock!.cache_control).toBeDefined();

    const userContent = prompt.messages[0].content;
    const userText =
      typeof userContent === "string"
        ? userContent
        : (userContent as Array<{ type: string; text: string }>)[0].text;
    expect(userText).not.toContain(TRANSCRIPT.slice(0, 50));
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
