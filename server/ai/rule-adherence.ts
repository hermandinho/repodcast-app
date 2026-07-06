import "server-only";

import type { RuleConstraint } from "./rule-parser";

/**
 * Validate generated content against the structured constraints
 * extracted from a show's voice rules. Runs in the generation pipeline
 * after Claude returns text, and the violation list gets persisted on
 * `GeneratedOutput.ruleViolations` for the UI to surface.
 *
 * No auto-rejection — a violated rule doesn't fail the pipeline. The
 * operator sees the flag and decides whether to regenerate.
 *
 * Pure. Deterministic. Same content + constraints always yields the
 * same message strings so downstream diffs stay stable.
 */
export function checkRuleAdherence(
  content: string,
  constraints: ReadonlyArray<RuleConstraint>,
): string[] {
  const violations: string[] = [];
  for (const c of constraints) {
    const msg = violationFor(c, content);
    if (msg) violations.push(msg);
  }
  return violations;
}

function violationFor(c: RuleConstraint, content: string): string | null {
  switch (c.kind) {
    case "no_hashtags": {
      const found = content.match(/#[a-z0-9_]+/gi);
      if (!found || found.length === 0) return null;
      // Show up to 3 examples so the operator sees which hashtags landed.
      const sample = found.slice(0, 3).join(", ");
      const rest = found.length > 3 ? `, +${found.length - 3} more` : "";
      return `No-hashtags rule violated (found ${sample}${rest}).`;
    }
    case "no_emoji": {
      const found = content.match(/\p{Extended_Pictographic}/gu);
      if (!found || found.length === 0) return null;
      return `No-emoji rule violated (found ${found.length} emoji character${found.length === 1 ? "" : "s"}).`;
    }
    case "banned_phrase": {
      // Word-boundary match — but only on ends of the phrase that are
      // themselves word characters. `\b` sits between a word and a
      // non-word char, so `\b40%\b` would need a word char after `%`
      // and fails on "40%" at end of a sentence. Skipping the boundary
      // on non-word edges keeps punctuation-heavy phrases working while
      // preserving the "hire" ≠ "hired" guard for alphanumeric phrases.
      const escaped = escapeRegex(c.phrase);
      const startsWithWord = /^\w/.test(c.phrase);
      const endsWithWord = /\w$/.test(c.phrase);
      const pattern = `${startsWithWord ? "\\b" : ""}${escaped}${endsWithWord ? "\\b" : ""}`;
      const re = new RegExp(pattern, "i");
      if (!re.test(content)) return null;
      return `Banned phrase used ("${c.phrase}").`;
    }
    case "max_words": {
      const words = content.trim().split(/\s+/).filter(Boolean).length;
      if (words <= c.limit) return null;
      return `Word limit exceeded (${words} vs. ${c.limit} max).`;
    }
    case "max_sentences": {
      const sentences = splitSentences(content);
      if (sentences.length <= c.limit) return null;
      return `Sentence limit exceeded (${sentences.length} vs. ${c.limit} max).`;
    }
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Coarse sentence splitter. We treat `.`, `!`, `?` (and their variants)
 * as terminators, but skip common decimals and ellipses so the count
 * doesn't inflate on numbers or intentional pauses.
 */
function splitSentences(content: string): string[] {
  const trimmed = content.trim();
  if (trimmed.length === 0) return [];
  // Replace ellipses so they don't count as three terminators, and
  // temporarily hide decimals so "3.5%" isn't split.
  const cleaned = trimmed.replace(/\.{2,}/g, "…").replace(/(\d)\.(\d)/g, "$1․$2");
  return cleaned
    .split(/[.!?]+\s+|[.!?]+$/u)
    .map((s) => s.trim())
    .filter(Boolean);
}
