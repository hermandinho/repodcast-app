import { describe, expect, it } from "vitest";
import { checkRuleAdherence } from "@/server/ai/rule-adherence";

describe("checkRuleAdherence — no_hashtags", () => {
  it("returns empty when the output has no hashtags", () => {
    const violations = checkRuleAdherence(
      "Hiring is the highest-leverage decision most founders make.",
      [{ kind: "no_hashtags" }],
    );
    expect(violations).toEqual([]);
  });

  it("flags a violation listing the offending hashtags", () => {
    const violations = checkRuleAdherence("Great hire — new to the team! #hiring #startup", [
      { kind: "no_hashtags" },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/no-hashtags rule violated/i);
    expect(violations[0]).toContain("#hiring");
    expect(violations[0]).toContain("#startup");
  });

  it("summarizes when more than 3 hashtags land", () => {
    const violations = checkRuleAdherence("Content: #a #b #c #d #e #f", [{ kind: "no_hashtags" }]);
    expect(violations[0]).toMatch(/\+3 more/);
  });
});

describe("checkRuleAdherence — no_emoji", () => {
  it("returns empty when the output has no emoji", () => {
    expect(checkRuleAdherence("Just words here.", [{ kind: "no_emoji" }])).toEqual([]);
  });

  it("flags emoji violations with a count", () => {
    const violations = checkRuleAdherence("Great news 🚀🎉", [{ kind: "no_emoji" }]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/no-emoji/i);
    expect(violations[0]).toMatch(/2 emoji/i);
  });
});

describe("checkRuleAdherence — banned_phrase", () => {
  it("catches banned phrases with word-boundary matching", () => {
    const violations = checkRuleAdherence("That launch was a real game-changer for us.", [
      { kind: "banned_phrase", phrase: "game-changer" },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('"game-changer"');
  });

  it("does not false-positive on substring matches inside other words", () => {
    // The rule bans "hire" — but the content contains "hired" (different
    // word). Word-boundary regex should skip it.
    const violations = checkRuleAdherence("We hired three engineers last quarter.", [
      { kind: "banned_phrase", phrase: "hire" },
    ]);
    expect(violations).toEqual([]);
  });

  it("is case-insensitive", () => {
    const violations = checkRuleAdherence("This is a SYNERGY moment.", [
      { kind: "banned_phrase", phrase: "synergy" },
    ]);
    expect(violations).toHaveLength(1);
  });

  it("safely handles phrases containing regex metacharacters", () => {
    const violations = checkRuleAdherence("Q3 outcomes: 40% growth", [
      { kind: "banned_phrase", phrase: "40%" },
    ]);
    expect(violations).toHaveLength(1);
  });
});

describe("checkRuleAdherence — max_words", () => {
  it("passes when under the limit", () => {
    expect(
      checkRuleAdherence("One two three four five.", [{ kind: "max_words", limit: 10 }]),
    ).toEqual([]);
  });

  it("flags when over the limit and includes the counts", () => {
    const content = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
    const violations = checkRuleAdherence(content, [{ kind: "max_words", limit: 10 }]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/20/);
    expect(violations[0]).toMatch(/10/);
  });
});

describe("checkRuleAdherence — max_sentences", () => {
  it("passes when under the limit", () => {
    expect(
      checkRuleAdherence("First. Second. Third.", [{ kind: "max_sentences", limit: 5 }]),
    ).toEqual([]);
  });

  it("flags when over the limit", () => {
    const violations = checkRuleAdherence("First. Second. Third. Fourth. Fifth. Sixth.", [
      { kind: "max_sentences", limit: 3 },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatch(/6/);
    expect(violations[0]).toMatch(/3/);
  });

  it("does not double-count decimals or ellipses", () => {
    // 3.5% and an ellipsis should still read as one sentence total, well
    // under the 5-sentence cap.
    expect(
      checkRuleAdherence("Growth was 3.5% last quarter…", [{ kind: "max_sentences", limit: 5 }]),
    ).toEqual([]);
  });
});

describe("checkRuleAdherence — composition", () => {
  it("returns one entry per violated constraint", () => {
    const violations = checkRuleAdherence("Great launch 🚀 #shipping — real game-changer.", [
      { kind: "no_hashtags" },
      { kind: "no_emoji" },
      { kind: "banned_phrase", phrase: "game-changer" },
    ]);
    expect(violations).toHaveLength(3);
  });

  it("returns empty when all constraints hold", () => {
    expect(
      checkRuleAdherence("Just plain text with no signals.", [
        { kind: "no_hashtags" },
        { kind: "no_emoji" },
        { kind: "banned_phrase", phrase: "synergy" },
      ]),
    ).toEqual([]);
  });
});
