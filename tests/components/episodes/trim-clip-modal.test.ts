import { describe, expect, it } from "vitest";
import { formatMsInput, parseMsInput } from "@/components/episodes/trim-clip-modal";

describe("formatMsInput", () => {
  it("renders whole seconds as M:SS", () => {
    expect(formatMsInput(0)).toBe("0:00");
    expect(formatMsInput(30_000)).toBe("0:30");
    expect(formatMsInput(90_000)).toBe("1:30");
  });

  it("renders sub-second precision as M:SS.mmm", () => {
    expect(formatMsInput(30_500)).toBe("0:30.500");
    expect(formatMsInput(1_234)).toBe("0:01.234");
  });

  it("floors sub-ms fractional input", () => {
    expect(formatMsInput(30_499.9)).toBe("0:30.499");
  });

  it("clamps negatives to zero", () => {
    expect(formatMsInput(-500)).toBe("0:00");
  });
});

describe("parseMsInput", () => {
  it("parses M:SS", () => {
    expect(parseMsInput("0:30")).toBe(30_000);
    expect(parseMsInput("1:15")).toBe(75_000);
    expect(parseMsInput("12:34")).toBe(754_000);
  });

  it("parses M:SS.mmm with three-digit ms", () => {
    expect(parseMsInput("0:30.500")).toBe(30_500);
    expect(parseMsInput("1:15.123")).toBe(75_123);
  });

  it("pads short ms fields", () => {
    // "0:30.5" — user typed one digit; we pad to 500 ms not 5 ms.
    expect(parseMsInput("0:30.5")).toBe(30_500);
    expect(parseMsInput("0:30.50")).toBe(30_500);
  });

  it("accepts bare integer seconds", () => {
    expect(parseMsInput("42")).toBe(42_000);
  });

  it("returns null on garbage", () => {
    expect(parseMsInput("")).toBeNull();
    expect(parseMsInput("abc")).toBeNull();
    expect(parseMsInput("1:2")).toBeNull(); // seconds must be 2 digits
    expect(parseMsInput("1:60")).toBeNull(); // seconds > 59
  });

  it("trims whitespace", () => {
    expect(parseMsInput("  1:15  ")).toBe(75_000);
  });

  it("round-trips through formatMsInput", () => {
    expect(parseMsInput(formatMsInput(75_000))).toBe(75_000);
    expect(parseMsInput(formatMsInput(30_500))).toBe(30_500);
  });
});
