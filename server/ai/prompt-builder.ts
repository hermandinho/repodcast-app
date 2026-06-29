import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { Platform } from "@prisma/client";
import { platformConfig } from "./platforms";
import { PLATFORM_PROMPTS } from "./prompts";

/**
 * Bundle of voice-profile data the prompt builder needs. Sourced from the
 * Client + VoiceSample tables at call time; tests construct synthetic ones.
 */
export type VoiceContext = {
  clientName: string;
  hostName: string;
  /** AI-generated narrative of the voice — Phase 2.1 keeps this fresh. */
  voiceDescription: string | null;
  /** Global custom instructions ("always do …"). */
  globalInstructions: string | null;
  /** Per-platform custom rules, keyed by platform. */
  perPlatformInstructions: Partial<Record<Platform, string>>;
  /** Approved samples this client has produced, used as few-shot. */
  samples: VoiceSampleForPrompt[];
};

export type VoiceSampleForPrompt = {
  platform: Platform;
  content: string;
};

/**
 * Pick the top-N samples to include as few-shot for `targetPlatform`.
 *
 * v2 strategy (Phase 2.1 tuning): on-platform → off-platform → fallback
 * stays the same, but within each bucket we now score samples instead of
 * trusting input order alone:
 *
 *   score = 0.7 * recency + 0.3 * lengthFit
 *
 * - **Recency** is derived from input index — callers pass newest-first
 *   (`orderBy: { createdAt: "desc" }` in the pipeline). Newest = 1.0,
 *   oldest = 0.2 (linear decay). Keeping recency in input order means the
 *   public type stays narrow (no `createdAt` field required) and the
 *   pipeline doesn't have to thread dates through.
 * - **Length fit** is scored against the SAMPLE's own platform — an
 *   off-platform sample should itself be a good example of its platform,
 *   not a contortion of the target's shape. Sweet spots are platform-
 *   tuned (see `LENGTH_SWEET_SPOTS`); inside the range = 1.0, linear
 *   decay outside, floor at 0.3 so length-edge samples still get a chance
 *   to be picked when the recency signal is strong.
 *
 * This stops a brand-new one-liner from edging out a slightly older,
 * representative sample and lets the prompt cache prefer the most useful
 * 20 samples instead of the most recent 20.
 */
export function selectSamples(
  samples: VoiceSampleForPrompt[],
  targetPlatform: Platform,
  { targetCount = 3, maxTotal = 5 }: { targetCount?: number; maxTotal?: number } = {},
): VoiceSampleForPrompt[] {
  if (samples.length === 0) return [];

  const scored = samples.map((s, idx) => ({
    sample: s,
    score: scoreSample(s, idx, samples.length),
  }));

  const byScoreDesc = (a: { score: number }, b: { score: number }): number => b.score - a.score;

  const onPlatform = scored.filter((x) => x.sample.platform === targetPlatform).sort(byScoreDesc);
  const offPlatform = scored.filter((x) => x.sample.platform !== targetPlatform).sort(byScoreDesc);

  const picked: VoiceSampleForPrompt[] = [];
  picked.push(...onPlatform.slice(0, targetCount).map((x) => x.sample));
  const afterTarget = maxTotal - picked.length;
  if (afterTarget > 0) {
    picked.push(...offPlatform.slice(0, afterTarget).map((x) => x.sample));
  }
  const stillNeed = maxTotal - picked.length;
  if (stillNeed > 0) {
    picked.push(...onPlatform.slice(targetCount, targetCount + stillNeed).map((x) => x.sample));
  }
  return picked.slice(0, maxTotal);
}

/**
 * Per-platform character-count sweet spots for `lengthFit`. Numbers reflect
 * realistic samples on each platform (single thread, single post, full
 * notes page, etc.) — not the model's idealLength string, which is a hint
 * to the *model*, not a scoring target for our few-shot picker.
 */
const LENGTH_SWEET_SPOTS: Record<Platform, { min: number; max: number }> = {
  TWITTER: { min: 600, max: 2400 },
  LINKEDIN: { min: 700, max: 1400 },
  INSTAGRAM: { min: 250, max: 900 },
  TIKTOK: { min: 400, max: 1100 },
  SHOW_NOTES: { min: 500, max: 2200 },
  BLOG: { min: 3500, max: 8000 },
  NEWSLETTER: { min: 1200, max: 4000 },
};

function scoreSample(sample: VoiceSampleForPrompt, index: number, total: number): number {
  // Recency: 1.0 at index 0 (newest), 0.2 at the oldest. With one sample
  // the decay denominator would be zero — short-circuit to 1.
  const recency = total <= 1 ? 1 : 1 - 0.8 * (index / (total - 1));
  const lengthFit = lengthFitFor(sample.platform, sample.content.length);
  return 0.7 * recency + 0.3 * lengthFit;
}

function lengthFitFor(platform: Platform, length: number): number {
  if (length === 0) return 0;
  const { min, max } = LENGTH_SWEET_SPOTS[platform];
  if (length >= min && length <= max) return 1.0;
  // Linear decay scaled to one window-width on either side; floor at 0.3
  // so length-edge samples still get a chance to be picked when the
  // recency signal is strong.
  const window = max - min || 1;
  const drift = length < min ? min - length : length - max;
  return Math.max(0.3, 1.0 - drift / window);
}

// ============================================================
// Block composers — each returns a fragment of the final messages array
// ============================================================

function identityBlock(voice: VoiceContext): string {
  const lines = [
    `You're writing for ${voice.clientName}, hosted by ${voice.hostName}.`,
    `Match this host's voice exactly — they review every output and will reject anything that sounds off.`,
  ];
  if (voice.voiceDescription) {
    lines.push("", "Voice profile:", voice.voiceDescription);
  }
  return lines.join("\n");
}

function samplesBlock(samples: VoiceSampleForPrompt[]): string | null {
  if (samples.length === 0) return null;
  const formatted = samples
    .map((s, i) => `Sample ${i + 1} (${s.platform.toLowerCase()}):\n${s.content}`)
    .join("\n\n---\n\n");
  return [
    "Approved samples in this host's voice. Match cadence, vocabulary, and structure — not topic:",
    "",
    formatted,
  ].join("\n");
}

function instructionsBlock(voice: VoiceContext, platform: Platform): string | null {
  const parts: string[] = [];
  if (voice.globalInstructions) {
    parts.push("Always:", voice.globalInstructions);
  }
  const platformRule = voice.perPlatformInstructions[platform];
  if (platformRule) {
    if (parts.length > 0) parts.push("");
    parts.push(`For ${platform}:`, platformRule);
  }
  return parts.length > 0 ? parts.join("\n") : null;
}

// ============================================================
// Final messages composition
// ============================================================

export type BuiltPrompt = {
  model: string;
  maxTokens: number;
  system: Anthropic.MessageCreateParams["system"];
  messages: Anthropic.MessageCreateParams["messages"];
};

/**
 * Build the messages array for a single platform generation.
 *
 * Caching strategy: identity + samples + global instructions are stable
 * across all 7 platform calls for the same episode, so we mark them
 * ephemeral. The platform-specific guidance + per-platform rules + the
 * transcript change per call.
 *
 * Result is ready to splat into `client.messages.create(...)`.
 */
export function buildMessages(opts: {
  platform: Platform;
  voice: VoiceContext;
  transcript: string;
  /** Model id; defaults to the constant in `claude.ts` for prod. */
  model: string;
  /**
   * One-shot instruction supplied for a regeneration ("make it shorter",
   * "more casual"). Appended to the per-call platform block — never cached
   * since it changes per regenerate.
   */
  extraInstruction?: string;
}): BuiltPrompt {
  const cfg = platformConfig(opts.platform);
  const samples = selectSamples(opts.voice.samples, opts.platform);

  // System: stable across platforms for the same episode → cacheable.
  const systemBlocks: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> =
    [{ type: "text", text: identityBlock(opts.voice), cache_control: { type: "ephemeral" } }];
  const samplesText = samplesBlock(samples);
  if (samplesText) {
    systemBlocks.push({ type: "text", text: samplesText, cache_control: { type: "ephemeral" } });
  }
  if (opts.voice.globalInstructions) {
    systemBlocks.push({
      type: "text",
      text: `Always:\n${opts.voice.globalInstructions}`,
      cache_control: { type: "ephemeral" },
    });
  }

  // Platform-specific block (per call) — not cached.
  const platformRule = opts.voice.perPlatformInstructions[opts.platform];
  const platformText = [
    PLATFORM_PROMPTS[opts.platform],
    "",
    `Constraints: ${cfg.format}`,
    `Target length: ${cfg.idealLength}.`,
    platformRule ? `Additional rule for ${opts.platform}: ${platformRule}` : "",
    opts.extraInstruction ? `One-time regenerate instruction: ${opts.extraInstruction}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  systemBlocks.push({ type: "text", text: platformText });

  const userMessage: Anthropic.MessageParam = {
    role: "user",
    content: [
      {
        type: "text",
        text: `Episode transcript:\n\n${opts.transcript}\n\nGenerate the ${cfg.fullName} now.`,
      },
    ],
  };

  return {
    model: opts.model,
    maxTokens: cfg.maxTokens,
    system: systemBlocks,
    messages: [userMessage],
  };
}

/**
 * Helper used by the generation pipeline + the validation script.
 * Returns the model's first text block, or throws if Claude returned no text.
 */
export function extractText(response: Anthropic.Message): string {
  for (const block of response.content) {
    if (block.type === "text") return block.text;
  }
  throw new Error("Claude returned no text content");
}
