import "server-only";

import { Platform } from "@prisma/client";

/**
 * Static metadata + generation constraints for each platform. The prompt
 * builder reads from here so we can add a platform by appending a row +
 * adding a prompt template — no other code changes.
 *
 * `maxTokens` caps the model output. `idealLength` is a soft target the
 * prompt nudges Claude toward.
 */
export type PlatformConfig = {
  platform: Platform;
  /** Short label (X / Twitter, LinkedIn, …). */
  name: string;
  /** Long label used in the New Episode wizard (X / Twitter Thread, …). */
  fullName: string;
  /** One-line constraint summary surfaced in the prompt. */
  format: string;
  /** Output-token ceiling for Claude. */
  maxTokens: number;
  /** Soft length guidance handed to the model. */
  idealLength: string;
};

export const PLATFORM_CONFIG: Record<Platform, PlatformConfig> = {
  TWITTER: {
    platform: Platform.TWITTER,
    name: "X / Twitter",
    fullName: "X / Twitter Thread",
    format:
      "A numbered thread of 5–8 tweets, each under 280 chars. No hashtags inside the thread body.",
    maxTokens: 1500,
    idealLength: "5–8 tweets",
  },
  LINKEDIN: {
    platform: Platform.LINKEDIN,
    name: "LinkedIn",
    fullName: "LinkedIn Post",
    format:
      "A single post 700–1,400 characters. Line breaks between ideas. Professional tone but conversational.",
    maxTokens: 1200,
    idealLength: "700–1,400 characters",
  },
  INSTAGRAM: {
    platform: Platform.INSTAGRAM,
    name: "Instagram",
    fullName: "Instagram Caption",
    format: "A caption under 125 words. End with 3–5 lowercase hashtags. Use 1–3 emojis sparingly.",
    maxTokens: 700,
    idealLength: "under 125 words",
  },
  TIKTOK: {
    platform: Platform.TIKTOK,
    name: "TikTok",
    fullName: "TikTok Script",
    format:
      "A short-form video script in beats. Hook in the first 3 seconds. Mark beats with [HOOK], [BEAT — 0:03], [BEAT — 0:09], [CTA].",
    maxTokens: 900,
    idealLength: "20–30 seconds",
  },
  SHOW_NOTES: {
    platform: Platform.SHOW_NOTES,
    name: "Show Notes",
    fullName: "Show Notes",
    format:
      "Summary paragraph + chapter timestamps (MM:SS — topic) + guest links. Include 5–8 timestamps minimum.",
    maxTokens: 1500,
    idealLength: "summary + timestamps",
  },
  BLOG: {
    platform: Platform.BLOG,
    name: "Blog Post",
    fullName: "Blog Post",
    format:
      "Long-form article 800–1,200 words. H1 matches episode title. Open with a scene or sharp observation. Present tense where possible.",
    maxTokens: 3500,
    idealLength: "800–1,200 words",
  },
  NEWSLETTER: {
    platform: Platform.NEWSLETTER,
    name: "Newsletter",
    fullName: "Newsletter",
    format:
      "Email issue with subject line (under 55 chars). Plain text. Sign off with the host's first name.",
    maxTokens: 1500,
    idealLength: "300–600 word body",
  },
};

export const ALL_PLATFORMS: Platform[] = Object.keys(PLATFORM_CONFIG) as Platform[];

export function platformConfig(platform: Platform): PlatformConfig {
  return PLATFORM_CONFIG[platform];
}
