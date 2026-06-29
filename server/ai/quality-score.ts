import "server-only";

import { Platform } from "@prisma/client";

/**
 * Cheap, deterministic per-platform quality heuristic. Runs in the
 * generation pipeline before persist so the rail's quality bars + the
 * `qualityByPlatformForEpisode` rollup reflect real output shape instead
 * of empty defaults.
 *
 * Two axes, each up to 50 points:
 *   - length    — does the output land inside the platform's idealLength?
 *   - structure — does it look like the platform expects (hashtags,
 *                 timestamps, beat markers, subject line, etc.)?
 *
 * Floors at 0 for empty / whitespace-only content. Caps at 100.
 *
 * Claude-as-judge scoring still TODO — that lands later as a refinement.
 */
export function scoreOutput(platform: Platform, content: string): number {
  const trimmed = content.trim();
  if (trimmed.length === 0) return 0;

  const length = lengthScore(platform, trimmed);
  const structure = structureScore(platform, trimmed);
  return Math.max(0, Math.min(100, Math.round(length + structure)));
}

// ============================================================
// Length axis (0–50)
// ============================================================

function lengthScore(platform: Platform, content: string): number {
  switch (platform) {
    case Platform.TWITTER: {
      const tweets = splitTweets(content);
      return rangeFit(tweets.length, 5, 8, 50);
    }
    case Platform.LINKEDIN:
      return rangeFit(content.length, 700, 1400, 50);
    case Platform.INSTAGRAM: {
      const words = wordCount(content);
      // Soft target: under 125 words. Floor when it overshoots.
      if (words === 0) return 0;
      if (words <= 125) return 50;
      // Decay linearly: every 25 words over halves the score.
      const over = words - 125;
      return Math.max(0, Math.round(50 - over * 0.8));
    }
    case Platform.TIKTOK:
      // No reliable second-count without TTS, so we use word count as a
      // proxy (20–30s at ~150 wpm ≈ 50–75 words). Allow a generous range.
      return rangeFit(wordCount(content), 40, 100, 50);
    case Platform.SHOW_NOTES:
      // No single length target — score on having a non-trivial body.
      return content.length >= 300 ? 50 : Math.round((content.length / 300) * 50);
    case Platform.BLOG:
      return rangeFit(wordCount(content), 800, 1200, 50);
    case Platform.NEWSLETTER: {
      const body = stripSubjectLine(content);
      return rangeFit(wordCount(body), 300, 600, 50);
    }
  }
}

// ============================================================
// Structure axis (0–50)
// ============================================================

function structureScore(platform: Platform, content: string): number {
  switch (platform) {
    case Platform.TWITTER: {
      const tweets = splitTweets(content);
      if (tweets.length === 0) return 0;
      const numbered = tweets.filter((t) => /^\d+\//.test(t)).length;
      const withinLimit = tweets.filter((t) => t.length <= 280).length;
      const numberedRatio = numbered / tweets.length;
      const limitRatio = withinLimit / tweets.length;
      // 30 points for "looks like a numbered thread", 20 for "every tweet fits".
      return Math.round(numberedRatio * 30 + limitRatio * 20);
    }
    case Platform.LINKEDIN: {
      // Line breaks between ideas — at least 3 paragraphs is the floor.
      const paragraphs = content.split(/\n{2,}/).filter((p) => p.trim().length > 0).length;
      const noHashtagSpam = countMatches(content, /#\w+/g) <= 3 ? 25 : 10;
      const paragraphScore = Math.min(25, paragraphs * 8);
      return noHashtagSpam + paragraphScore;
    }
    case Platform.INSTAGRAM: {
      const hashtags = content.match(/#[a-z0-9_]+/gi) ?? [];
      const lowercase = hashtags.filter((h) => h === h.toLowerCase()).length;
      const hashtagFit = hashtags.length >= 3 && hashtags.length <= 5;
      const lowercaseRatio = hashtags.length === 0 ? 0 : lowercase / hashtags.length;
      const emojiCount = countEmoji(content);
      const emojiFit = emojiCount >= 1 && emojiCount <= 3;
      return (hashtagFit ? 20 : 5) + Math.round(lowercaseRatio * 15) + (emojiFit ? 15 : 5);
    }
    case Platform.TIKTOK: {
      const hook = /\[HOOK[^\]]*\]/i.test(content);
      const beats = countMatches(content, /\[BEAT[^\]]*\]/gi);
      const cta = /\[CTA[^\]]*\]/i.test(content);
      return (hook ? 15 : 0) + Math.min(20, beats * 7) + (cta ? 15 : 0);
    }
    case Platform.SHOW_NOTES: {
      const timestamps = countMatches(content, /\b\d{1,2}:\d{2}\b/g);
      // 5–8 timestamps is the minimum guidance. 5 hits 25, 8+ caps the slice.
      const timestampScore = Math.min(35, timestamps * 5);
      const hasSummary = content.split(/\n{2,}/)[0]?.length >= 80 ? 15 : 5;
      return timestampScore + hasSummary;
    }
    case Platform.BLOG: {
      const hasH1 = /^#\s+\S/m.test(content) || /^[^\n]{4,}\n=+\n/.test(content);
      const paragraphs = content.split(/\n{2,}/).filter((p) => p.trim().length > 0).length;
      // Long-form needs a headline and at least a few paragraphs of structure.
      return (hasH1 ? 20 : 5) + Math.min(30, paragraphs * 5);
    }
    case Platform.NEWSLETTER: {
      const subjectLine = firstNonEmptyLine(content);
      const subjectMatch = subjectLine.match(/^subject:\s*(.+)$/i);
      const subjectFit = subjectMatch
        ? subjectMatch[1].trim().length > 0 && subjectMatch[1].trim().length <= 55
        : false;
      // Sign-off: a short final line (typical first-name sign-off).
      const lines = content
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean);
      const tail = lines[lines.length - 1] ?? "";
      const signOff = tail.length > 0 && tail.length <= 30 && !/[.?!]$/.test(tail);
      return (subjectFit ? 30 : 5) + (signOff ? 20 : 5);
    }
  }
}

// ============================================================
// Helpers
// ============================================================

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * 50 when `value` is inside [low, high]; decays linearly toward 0 as it
 * drifts further outside. Tolerance is one full window-width on each side.
 */
function rangeFit(value: number, low: number, high: number, maxPoints = 50): number {
  if (value <= 0) return 0;
  if (value >= low && value <= high) return maxPoints;
  const window = high - low || 1;
  const drift = value < low ? low - value : value - high;
  const ratio = Math.max(0, 1 - drift / window);
  return Math.round(maxPoints * ratio);
}

/** Split a thread into tweets by blank lines OR a leading number-slash. */
function splitTweets(content: string): string[] {
  // Prefer blank-line separation; fall back to splitting on lines that
  // start with "N/" markers when the model wrote them in one paragraph.
  const blocks = content
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  if (blocks.length >= 3) return blocks;
  return content
    .split(/(?=^\d+\/\s)/m)
    .map((t) => t.trim())
    .filter(Boolean);
}

function countMatches(s: string, re: RegExp): number {
  return s.match(re)?.length ?? 0;
}

/**
 * Crude emoji counter — covers the BMP + supplementary symbol planes that
 * cover what platforms-style content actually uses. Doesn't try to handle
 * ZWJ sequences perfectly; treats each visible glyph as a unit.
 */
function countEmoji(s: string): number {
  const matches = s.match(/\p{Extended_Pictographic}/gu);
  return matches?.length ?? 0;
}

function stripSubjectLine(content: string): string {
  // Drop a leading "Subject: …" line from word-count math for newsletters.
  return content.replace(/^\s*subject:[^\n]*\n+/i, "");
}

function firstNonEmptyLine(s: string): string {
  for (const line of s.split(/\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return "";
}
