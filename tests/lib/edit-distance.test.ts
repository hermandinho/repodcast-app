import { describe, expect, it } from "vitest";
import { levenshtein } from "@/lib/edit-distance";

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshtein("hello", "hello")).toBe(0);
    expect(levenshtein("", "")).toBe(0);
  });

  it("returns the length of the non-empty string when the other is empty", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });

  it("counts a single substitution", () => {
    expect(levenshtein("cat", "bat")).toBe(1);
  });

  it("counts a single insertion", () => {
    expect(levenshtein("cat", "cats")).toBe(1);
  });

  it("counts a single deletion", () => {
    expect(levenshtein("cats", "cat")).toBe(1);
  });

  it("handles the canonical kitten/sitting example (3 edits)", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });

  it("handles longer realistic content edits", () => {
    const a = "The quick brown fox jumps over the lazy dog.";
    const b = "The quick brown fox leaps over the lazy dog.";
    // "jumps" → "leaps": j→l, u→e, m→a, p→p (same), s→s — 3 subs
    expect(levenshtein(a, b)).toBe(3);
  });

  it("is symmetric — distance(a, b) == distance(b, a)", () => {
    expect(levenshtein("hello world", "world hello")).toBe(
      levenshtein("world hello", "hello world"),
    );
  });

  it("works on inputs the length of typical platform outputs", () => {
    // ~2KB content with a single-char tweak in the middle.
    const a = "x".repeat(2048);
    const b = a.slice(0, 1024) + "y" + a.slice(1025);
    expect(levenshtein(a, b)).toBe(1);
  });
});
