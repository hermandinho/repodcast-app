import { describe, expect, it } from "vitest";
import {
  buildImagePrompt,
  parseArtworkConcept,
  type ArtworkConcept,
} from "@/server/ai/artwork-concept";

const VALID: ArtworkConcept = {
  subject: "A lone chess piece on an empty highway at dusk",
  mood: "contemplative",
  palette: "amber, deep navy, warm grey",
  textOverlay: "PLAY LONG",
  style: "cinematic editorial photography, high contrast",
};

describe("parseArtworkConcept", () => {
  it("parses clean JSON", () => {
    const c = parseArtworkConcept(JSON.stringify(VALID));
    expect(c).toEqual(VALID);
  });

  it("strips ```json fences", () => {
    const c = parseArtworkConcept("```json\n" + JSON.stringify(VALID) + "\n```");
    expect(c.subject).toBe(VALID.subject);
  });

  it("recovers from surrounding prose", () => {
    const c = parseArtworkConcept(
      `Here is the concept:\n\n${JSON.stringify(VALID)}\n\nLet me know.`,
    );
    expect(c.mood).toBe("contemplative");
  });

  it("defaults missing fields to empty strings", () => {
    const c = parseArtworkConcept(JSON.stringify({ subject: "A cracked jar" }));
    expect(c.subject).toBe("A cracked jar");
    expect(c.mood).toBe("");
    expect(c.palette).toBe("");
    expect(c.textOverlay).toBe("");
    expect(c.style).toBe("");
  });

  it("trims whitespace from string fields", () => {
    const c = parseArtworkConcept(
      JSON.stringify({
        subject: "  padded  ",
        mood: " x ",
        palette: "  ",
        textOverlay: "  hi  ",
        style: " ",
      }),
    );
    expect(c.subject).toBe("padded");
    expect(c.mood).toBe("x");
    expect(c.textOverlay).toBe("hi");
  });

  it("throws on garbage input", () => {
    expect(() => parseArtworkConcept("this is not json anywhere")).toThrow(
      /Could not parse artwork concept/,
    );
  });
});

describe("buildImagePrompt", () => {
  it("includes subject, mood, palette, style", () => {
    const p = buildImagePrompt(VALID, "16:9");
    expect(p).toContain("lone chess piece");
    expect(p).toContain("contemplative");
    expect(p).toContain("amber, deep navy");
    expect(p).toContain("cinematic editorial");
  });

  it("switches the composition directive per aspect", () => {
    expect(buildImagePrompt(VALID, "16:9")).toMatch(/16:9|horizontal|cinematic framing/i);
    expect(buildImagePrompt(VALID, "1:1")).toMatch(/1:1|square|centered/i);
    expect(buildImagePrompt(VALID, "9:16")).toMatch(/9:16|tall|vertical/i);
  });

  it("includes the text overlay when set", () => {
    expect(buildImagePrompt(VALID, "16:9")).toContain("PLAY LONG");
  });

  it("declares no-text when the overlay is empty", () => {
    const noText: ArtworkConcept = { ...VALID, textOverlay: "" };
    const p = buildImagePrompt(noText, "16:9");
    expect(p).toMatch(/no text/i);
  });
});
