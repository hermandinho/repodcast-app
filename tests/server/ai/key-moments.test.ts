import { describe, expect, it } from "vitest";
import { parseKeyMoments } from "@/server/ai/key-moments";

const VALID_JSON = JSON.stringify([
  {
    topic: "Hire for slope",
    quote: "Hire for slope, not intercept.",
    timestamp: "11:40",
    insight: "Trajectory beats résumé.",
  },
  {
    topic: "Culture doc test",
    quote: "If you can't write it, you're not ready to hire.",
    insight: "Forces founders to articulate values before scaling them.",
  },
]);

describe("parseKeyMoments", () => {
  it("parses clean JSON", () => {
    const moments = parseKeyMoments(VALID_JSON);
    expect(moments).toHaveLength(2);
    expect(moments[0].topic).toBe("Hire for slope");
    expect(moments[0].timestamp).toBe("11:40");
    expect(moments[1].timestamp).toBeUndefined();
  });

  it("strips ```json fences", () => {
    const wrapped = "```json\n" + VALID_JSON + "\n```";
    expect(parseKeyMoments(wrapped)).toHaveLength(2);
  });

  it("strips plain ``` fences", () => {
    const wrapped = "```\n" + VALID_JSON + "\n```";
    expect(parseKeyMoments(wrapped)).toHaveLength(2);
  });

  it("recovers from leading prose by finding the [...] slice", () => {
    const sloppy = "Here are the moments:\n\n" + VALID_JSON + "\n\nLet me know if you want more.";
    expect(parseKeyMoments(sloppy)).toHaveLength(2);
  });

  it("filters out empty / malformed rows", () => {
    const dirty = JSON.stringify([
      { topic: "valid", quote: "yes", insight: "good" },
      { topic: "", quote: "missing topic", insight: "bad" },
      { topic: "no quote", quote: "", insight: "bad" },
      null,
      "string-not-object",
    ]);
    const result = parseKeyMoments(dirty);
    expect(result).toHaveLength(1);
    expect(result[0].topic).toBe("valid");
  });

  it("throws when there's no JSON anywhere", () => {
    expect(() => parseKeyMoments("hello world, no JSON here")).toThrow(
      /Could not parse key moments/,
    );
  });

  it("trims whitespace from string fields", () => {
    const padded = JSON.stringify([
      { topic: "  spaces  ", quote: "  yes  ", timestamp: "  03:14  ", insight: "  trim me " },
    ]);
    const [m] = parseKeyMoments(padded);
    expect(m.topic).toBe("spaces");
    expect(m.quote).toBe("yes");
    expect(m.timestamp).toBe("03:14");
    expect(m.insight).toBe("trim me");
  });

  it("treats empty timestamp string as undefined", () => {
    const tsEmpty = JSON.stringify([{ topic: "no ts", quote: "q", timestamp: "  ", insight: "i" }]);
    expect(parseKeyMoments(tsEmpty)[0].timestamp).toBeUndefined();
  });
});
