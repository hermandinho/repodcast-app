import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { Platform } from "@prisma/client";
import { platformConfig } from "./platforms";
import { PLATFORM_PROMPTS } from "./prompts";
import { parseVoiceRules, renderConstraint, type RuleConstraint } from "./rule-parser";

/**
 * Bundle of voice-profile data the prompt builder needs. Sourced from the
 * Client + VoiceSample tables at call time; tests construct synthetic ones.
 */
export type VoiceContext = {
  clientName: string;
  hostName: string;
  /** AI-generated narrative of the voice — kept fresh by the voice-refresh pipeline. */
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
  /**
   * Cumulative character-edit distance between the AI's original output
   * and the version that was ultimately approved. Optional — legacy
   * samples and portal-created samples with no linked GeneratedOutput
   * are treated as untouched (editFit = 1.0). Sourced from
   * `GeneratedOutput.editDistance`.
   */
  editDistance?: number;
};

/**
 * Pick the top-N samples to include as few-shot for `targetPlatform`.
 *
 * v3 strategy: on-platform → off-platform → fallback bucketing stays the
 * same, but each candidate is scored across three axes:
 *
 *   score = (0.7 * recency + 0.3 * lengthFit) * editFit
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
 * - **Edit fit** applies as a multiplier so a heavily edited approval
 *   gets demoted regardless of how strong its recency + length signal is.
 *   An untouched approval (editDistance = 0) scores 1.0; a rewrite whose
 *   edit distance is ≥ the sample's own length scores at the floor (0.2).
 *   Missing editDistance defaults to 1.0 so pre-tracking (or portal)
 *   samples aren't retroactively demoted.
 *
 * Rationale: heavily-edited approvals encode the operator's rewrite of
 * the AI, not the host's voice — so training on them amplifies the model's
 * fix-ups rather than the actual style we want to match.
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
  const offPlatform = scored.filter((x) => x.sample.platform !== targetPlatform);

  const picked: VoiceSampleForPrompt[] = [];
  picked.push(...onPlatform.slice(0, targetCount).map((x) => x.sample));

  const offSlots = maxTotal - picked.length;
  if (offSlots > 0 && offPlatform.length > 0) {
    picked.push(...diversifyOffPlatform(offPlatform, offSlots));
  }

  const stillNeed = maxTotal - picked.length;
  if (stillNeed > 0) {
    picked.push(...onPlatform.slice(targetCount, targetCount + stillNeed).map((x) => x.sample));
  }
  return picked.slice(0, maxTotal);
}

/**
 * Round-robin pick across each represented off-platform, one sample per
 * pass in descending score order. Stops a show with 15 Twitter approvals
 * + 1 LinkedIn + 1 Blog from filling every off-platform slot with Twitter,
 * which would starve the prompt of tonal breadth even though the pool
 * contains it.
 *
 * Platform rotation order is seeded by the top score of each bucket, so
 * the highest-signal platform still goes first — we diversify *among* the
 * off-platforms, we don't ignore score. Within a platform, the highest-
 * scoring sample is taken first; second-best in each platform only comes
 * back around after every other platform has been served once.
 */
function diversifyOffPlatform(
  scored: Array<{ sample: VoiceSampleForPrompt; score: number }>,
  slots: number,
): VoiceSampleForPrompt[] {
  const byPlatform = new Map<Platform, Array<{ sample: VoiceSampleForPrompt; score: number }>>();
  for (const item of scored) {
    const list = byPlatform.get(item.sample.platform) ?? [];
    list.push(item);
    byPlatform.set(item.sample.platform, list);
  }
  for (const list of byPlatform.values()) list.sort((a, b) => b.score - a.score);

  // Rotation order = the highest-scoring platform first, so we don't
  // squander an early slot on a weak platform just because it exists.
  const platformOrder = Array.from(byPlatform.keys()).sort((a, b) => {
    const topA = byPlatform.get(a)![0].score;
    const topB = byPlatform.get(b)![0].score;
    return topB - topA;
  });

  const picked: VoiceSampleForPrompt[] = [];
  let round = 0;
  while (picked.length < slots) {
    let addedThisRound = false;
    for (const platform of platformOrder) {
      const list = byPlatform.get(platform)!;
      if (round < list.length) {
        picked.push(list[round].sample);
        addedThisRound = true;
        if (picked.length >= slots) break;
      }
    }
    if (!addedThisRound) break;
    round++;
  }
  return picked;
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
  const editFit = editFitFor(sample.editDistance, sample.content.length);
  return (0.7 * recency + 0.3 * lengthFit) * editFit;
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

/**
 * Score a sample by how close it is to the AI's original draft. Ratio of
 * edit distance to sample length: 0 → untouched (1.0), ≥ 1 → totally
 * rewritten (floor 0.2). Missing editDistance means the sample predates
 * tracking (or came from a portal path without an output linkage) — treat
 * as untouched so we don't retroactively downgrade the existing training
 * pool.
 */
function editFitFor(editDistance: number | undefined, length: number): number {
  if (editDistance === undefined) return 1.0;
  if (length <= 0) return 1.0;
  const ratio = Math.min(1, editDistance / length);
  return Math.max(0.2, 1 - ratio);
}

// ============================================================
// Block composers — each returns a fragment of the final messages array
// ============================================================

function identityBlock(voice: VoiceContext): string {
  const lines = [
    `You're writing for ${voice.clientName}, hosted by ${voice.hostName}.`,
    `Match this host's voice — cadence, vocabulary, and structure — unless a custom rule below says otherwise. Custom rules always win over sample style.`,
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

/**
 * Compose a rules block: freeform text (verbatim, so unparseable rules
 * still land) followed by a machine-checkable "Hard constraints" list
 * derived from `parseVoiceRules`. When nothing parses, only the freeform
 * text renders — so shows using purely tonal rules ("write like a peer")
 * see zero change.
 */
function renderRuleBlock(input: {
  heading: string;
  freeform: string;
  constraints: RuleConstraint[];
}): string {
  const parts: string[] = [input.heading, input.freeform];
  if (input.constraints.length > 0) {
    parts.push("", "Hard constraints extracted from those rules:");
    for (const c of input.constraints) parts.push(`- ${renderConstraint(c)}`);
  }
  return parts.join("\n");
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
 * Caching strategy: identity + samples + global instructions + transcript
 * are stable across all N platform calls for the same episode, so each
 * carries a `cache_control: ephemeral` breakpoint (Anthropic allows up to
 * 4). Only the trailing platform-specific block varies per call. The user
 * message is a one-liner ask — putting the transcript into the *system*
 * lets it participate in the cached prefix, cutting input-token latency
 * and cost by ~90 % on the sibling parallel calls and on later regenerates
 * within the 5-minute TTL.
 *
 * Block order (least → most variable):
 *   1. identity                (per client, stable per episode)   [cached]
 *   2. samples                 (per client, stable per episode)   [cached]
 *   3. global instructions     (per client, stable per episode)   [cached]
 *   4. transcript              (per episode, stable across calls) [cached]
 *   5. platform + extraInstr   (per call)                         uncached
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
    // Restate any machine-parseable constraints ("no hashtags",
    // "under 200 words", banned phrases) as explicit imperatives after
    // the freeform text. Freeform survives — some rules don't parse
    // and shouldn't be dropped — but for the ones we can extract, the
    // model sees them twice, in unmissable form.
    systemBlocks.push({
      type: "text",
      text: renderRuleBlock({
        heading:
          "Non-negotiable rules for this show — these override voice-matching, sample style, and platform norms. Apply them to every output without exception:",
        freeform: opts.voice.globalInstructions,
        constraints: parseVoiceRules(opts.voice.globalInstructions),
      }),
      cache_control: { type: "ephemeral" },
    });
  }

  // Transcript block: stable across the N platform calls of the same
  // episode (and across regenerates). Marked as the final cache
  // breakpoint so identity/samples/global partial-match cache hits still
  // work when transcript changes but the voice profile is stable.
  systemBlocks.push({
    type: "text",
    text: `Episode transcript:\n\n${opts.transcript}`,
    cache_control: { type: "ephemeral" },
  });

  // Platform-specific block (per call) — not cached.
  const platformRule = opts.voice.perPlatformInstructions[opts.platform];
  const platformConstraints: RuleConstraint[] = platformRule ? parseVoiceRules(platformRule) : [];
  const platformText = [
    PLATFORM_PROMPTS[opts.platform],
    "",
    `Constraints: ${cfg.format}`,
    `Target length: ${cfg.idealLength}.`,
    platformRule
      ? `Non-negotiable rule for ${opts.platform} — overrides voice-matching, sample style, AND the platform guidance above (including any emoji, hashtag, formatting, or structural bans). Follow this rule even when it contradicts an earlier bullet: ${platformRule}`
      : "",
    platformConstraints.length > 0
      ? `Hard constraints extracted from that rule:\n${platformConstraints.map((c) => `- ${renderConstraint(c)}`).join("\n")}`
      : "",
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
        text: `Generate the ${cfg.fullName} now.`,
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
