import "server-only";

/**
 * Best-effort parser that turns free-text voice rules (global or per-
 * platform, from `Show.globalInstructions` and
 * `ShowPlatformInstruction.rule`) into structured constraints. Two
 * downstream consumers use the result:
 *
 *   1. `prompt-builder.ts` — restates parseable rules as explicit,
 *      unmissable instructions in the system block so the model treats
 *      them as hard constraints rather than tone hints.
 *   2. `rule-adherence.ts` — validates generated output against the
 *      same constraints so the UI can flag when a rule was ignored.
 *
 * Design constraints:
 *   - Pure and deterministic. No I/O, no LLM calls.
 *   - Conservative — false negatives are preferable to false positives.
 *     A rule that fails to parse still passes through as freeform text,
 *     so the model sees it; we just don't try to validate it.
 *   - Regex-driven. Regexes are documented per-branch with the exact
 *     phrasings they cover so future contributors don't guess.
 */

export type RuleConstraint =
  | { kind: "no_hashtags" }
  | { kind: "no_emoji" }
  | { kind: "banned_phrase"; phrase: string }
  | { kind: "max_words"; limit: number }
  | { kind: "max_sentences"; limit: number };

/**
 * Parse a rule blob into structured constraints. Empty / whitespace-only
 * input returns `[]`. A single blob can yield multiple constraints (e.g.
 * "no hashtags, no emoji, never say game-changer" → three constraints).
 */
export function parseVoiceRules(text: string | null | undefined): RuleConstraint[] {
  if (!text) return [];
  const normalized = text.toLowerCase();
  const constraints: RuleConstraint[] = [];

  // ---- No-hashtag rules ----------------------------------------------
  // Covers: "no hashtags", "don't use hashtags", "avoid hashtags",
  // "no # tags", "without hashtags". Skip "no more than N hashtags" —
  // that's a bounded count we don't model yet.
  if (
    /\b(no|don'?t use|avoid|without|never use)\s+(hash\s*tag|#)/i.test(text) &&
    !/no more than \d+ hashtags?/i.test(text)
  ) {
    constraints.push({ kind: "no_hashtags" });
  }

  // ---- No-emoji rules ------------------------------------------------
  // Covers: "no emoji(s)", "don't use emoji(s)", "avoid emoji(s)",
  // "without emoji". Same "no more than N" carve-out.
  if (
    /\b(no|don'?t use|avoid|without|never use)\s+emojis?\b/i.test(text) &&
    !/no more than \d+ emojis?/i.test(text)
  ) {
    constraints.push({ kind: "no_emoji" });
  }

  // ---- Banned phrases ------------------------------------------------
  // Patterns:
  //   - never (say|use|write) "X"
  //   - don't (say|use|write) "X"
  //   - avoid "X" / avoid the word "X"
  //   - never use game-changer  (unquoted, single word — captured too)
  // We only capture quoted phrases OR single-word forms after
  // `never/don't (say|use|write)` to avoid over-triggering on prose.
  const bannedRe =
    /(?:never|don'?t)\s+(?:say|use|write)\s+["“']([^"”'\n]+)["”']|avoid\s+(?:the\s+word\s+)?["“']([^"”'\n]+)["”']|(?:never|don'?t)\s+(?:say|use|write)\s+([a-z][\w-]{2,})/gi;
  const seenPhrases = new Set<string>();
  for (const m of text.matchAll(bannedRe)) {
    const phrase = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (phrase.length === 0) continue;
    const key = phrase.toLowerCase();
    if (seenPhrases.has(key)) continue;
    seenPhrases.add(key);
    constraints.push({ kind: "banned_phrase", phrase });
  }

  // ---- Word / sentence limits ----------------------------------------
  // Covers: "under N words", "at most N words", "keep it under N words",
  //         "no more than N words", "max N words", "≤ N words".
  const maxWordsRe =
    /(?:under|at most|no more than|max(?:imum)?|less than|≤|<=)\s+(\d{2,4})\s+words/i;
  const maxWordsMatch = normalized.match(maxWordsRe);
  if (maxWordsMatch) {
    const limit = parseInt(maxWordsMatch[1], 10);
    if (limit > 0 && limit < 100_000) constraints.push({ kind: "max_words", limit });
  }

  const maxSentencesRe =
    /(?:under|at most|no more than|max(?:imum)?|less than|≤|<=)\s+(\d{1,3})\s+sentences?/i;
  const maxSentencesMatch = normalized.match(maxSentencesRe);
  if (maxSentencesMatch) {
    const limit = parseInt(maxSentencesMatch[1], 10);
    if (limit > 0 && limit < 1_000) constraints.push({ kind: "max_sentences", limit });
  }

  // Ranged forms: "3-5 sentences", "3 to 5 sentences" → treat the upper
  // bound as a soft ceiling. Uses the upper number when both are
  // present; single-number ranges are handled by the max-only patterns.
  const rangeSentencesRe = /(\d{1,3})\s*(?:-|–|to)\s*(\d{1,3})\s+sentences?/i;
  const rangeSentencesMatch = normalized.match(rangeSentencesRe);
  if (rangeSentencesMatch) {
    const upper = parseInt(rangeSentencesMatch[2], 10);
    if (upper > 0 && !constraints.some((c) => c.kind === "max_sentences")) {
      constraints.push({ kind: "max_sentences", limit: upper });
    }
  }

  return constraints;
}

/**
 * Render a constraint as a single-line, imperative instruction for the
 * model. The prompt-builder joins these into a "hard constraints" block
 * that lands after the freeform rule text.
 */
export function renderConstraint(c: RuleConstraint): string {
  switch (c.kind) {
    case "no_hashtags":
      return "Do not use hashtags anywhere in the output.";
    case "no_emoji":
      return "Do not use emoji anywhere in the output.";
    case "banned_phrase":
      return `Do not use the word or phrase "${c.phrase}".`;
    case "max_words":
      return `Keep the output under ${c.limit} words.`;
    case "max_sentences":
      return `Keep the output to at most ${c.limit} sentences.`;
  }
}
