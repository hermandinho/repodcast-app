import { describe, expect, it } from "vitest";
import { parseVoiceRules, renderConstraint } from "@/server/ai/rule-parser";

describe("parseVoiceRules", () => {
  it("returns an empty array for null / whitespace-only input", () => {
    expect(parseVoiceRules(null)).toEqual([]);
    expect(parseVoiceRules(undefined)).toEqual([]);
    expect(parseVoiceRules("")).toEqual([]);
    expect(parseVoiceRules("   \n\t  ")).toEqual([]);
  });

  it("extracts no-hashtag rules from common phrasings", () => {
    for (const text of [
      "No hashtags.",
      "Don't use hashtags.",
      "don't use hash tags in any post",
      "Avoid hashtags everywhere.",
      "Never use hashtags.",
      "Without hashtags — they read as corporate.",
    ]) {
      expect(parseVoiceRules(text)).toContainEqual({ kind: "no_hashtags" });
    }
  });

  it("skips the no-hashtag rule when the operator set a numeric limit", () => {
    // "No more than 3 hashtags" is a bounded count, not a ban.
    expect(parseVoiceRules("No more than 3 hashtags per post")).not.toContainEqual({
      kind: "no_hashtags",
    });
  });

  it("extracts no-emoji rules from common phrasings", () => {
    for (const text of [
      "No emoji.",
      "no emojis anywhere",
      "Don't use emojis.",
      "Avoid emoji.",
      "Never use emoji.",
    ]) {
      expect(parseVoiceRules(text)).toContainEqual({ kind: "no_emoji" });
    }
  });

  it("extracts banned phrases from quoted forms", () => {
    const constraints = parseVoiceRules(
      `Never say "game-changer". Don't use 'synergy'. Avoid the word "leverage".`,
    );
    const phrases = constraints
      .filter((c): c is { kind: "banned_phrase"; phrase: string } => c.kind === "banned_phrase")
      .map((c) => c.phrase.toLowerCase());
    expect(phrases).toContain("game-changer");
    expect(phrases).toContain("synergy");
    expect(phrases).toContain("leverage");
  });

  it("extracts banned phrases from single-word unquoted forms", () => {
    const constraints = parseVoiceRules("Never use crushed and don't write disruptive");
    const phrases = constraints
      .filter((c): c is { kind: "banned_phrase"; phrase: string } => c.kind === "banned_phrase")
      .map((c) => c.phrase.toLowerCase());
    expect(phrases).toContain("crushed");
    expect(phrases).toContain("disruptive");
  });

  it("de-duplicates banned phrases across match forms", () => {
    const constraints = parseVoiceRules(
      `Never say "synergy". Don't use "synergy". Avoid "synergy".`,
    );
    const synergyCount = constraints.filter(
      (c) => c.kind === "banned_phrase" && c.phrase.toLowerCase() === "synergy",
    ).length;
    expect(synergyCount).toBe(1);
  });

  it("extracts word limits from common phrasings", () => {
    for (const [text, limit] of [
      ["Keep it under 200 words", 200],
      ["at most 150 words", 150],
      ["No more than 300 words per post", 300],
      ["Max 250 words.", 250],
      ["Less than 180 words", 180],
    ] as const) {
      expect(parseVoiceRules(text)).toContainEqual({ kind: "max_words", limit });
    }
  });

  it("extracts sentence limits from max-only phrasings", () => {
    for (const [text, limit] of [
      ["Under 5 sentences", 5],
      ["At most 3 sentences", 3],
      ["No more than 8 sentences per post", 8],
    ] as const) {
      expect(parseVoiceRules(text)).toContainEqual({ kind: "max_sentences", limit });
    }
  });

  it("extracts sentence limits from ranged phrasings (uses upper bound)", () => {
    for (const [text, upper] of [
      ["3-5 sentences", 5],
      ["3–5 sentences", 5],
      ["3 to 5 sentences", 5],
    ] as const) {
      expect(parseVoiceRules(text)).toContainEqual({ kind: "max_sentences", limit: upper });
    }
  });

  it("gracefully returns nothing for tonal-only rules", () => {
    // Pure tone directions have no machine-checkable constraints — parser
    // should NOT hallucinate anything and downstream logic should still
    // pass the freeform text into the prompt.
    expect(parseVoiceRules("Write like a peer, not a salesperson.")).toEqual([]);
    expect(parseVoiceRules("Warm and direct, no fluff.")).toEqual([]);
  });

  it("combines multiple constraints from one rule blob", () => {
    const constraints = parseVoiceRules(
      `No hashtags. No emojis. Keep it under 200 words. Never say "game-changer".`,
    );
    const kinds = constraints.map((c) => c.kind);
    expect(kinds).toContain("no_hashtags");
    expect(kinds).toContain("no_emoji");
    expect(kinds).toContain("max_words");
    expect(kinds).toContain("banned_phrase");
  });
});

describe("renderConstraint", () => {
  it("emits an imperative sentence per constraint kind", () => {
    expect(renderConstraint({ kind: "no_hashtags" })).toMatch(/hashtag/i);
    expect(renderConstraint({ kind: "no_emoji" })).toMatch(/emoji/i);
    expect(renderConstraint({ kind: "banned_phrase", phrase: "synergy" })).toContain('"synergy"');
    expect(renderConstraint({ kind: "max_words", limit: 200 })).toMatch(/200 words/);
    expect(renderConstraint({ kind: "max_sentences", limit: 5 })).toMatch(/5 sentences/);
  });
});
