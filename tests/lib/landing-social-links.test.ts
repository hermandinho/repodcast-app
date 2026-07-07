/**
 * `getLandingSocialLinks` is the reader the landing page depends on. If it
 * silently returns garbage on a schema drift or DB blip, the marketing
 * footer either renders broken icons or 500s the whole page. Every branch
 * here (missing key → default, invalid JSON → default, valid → parsed) is
 * exercised via the module's real Zod schema.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSystemConfigValue: vi.fn(),
  isLiveDb: vi.fn(),
}));

vi.mock("@/server/db/system/config", () => ({
  getSystemConfigValue: mocks.getSystemConfigValue,
}));

vi.mock("@/server/data/source", () => ({
  isLiveDb: mocks.isLiveDb,
}));

import {
  DEFAULT_SOCIAL_LINKS,
  getLandingSocialLinks,
  landingSocialLinksSchema,
} from "@/lib/landing-social-links";

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  // Every test in this file exercises the live-DB path unless it opts out.
  mocks.isLiveDb.mockReturnValue(true);
});

describe("landingSocialLinksSchema", () => {
  it("accepts a valid links list with just the required fields", () => {
    const parsed = landingSocialLinksSchema.safeParse({
      links: [
        { platform: "twitter", href: "https://twitter.com/repodcastapp" },
        { platform: "linkedin", href: "https://www.linkedin.com/company/repodcast" },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown platform slug", () => {
    const parsed = landingSocialLinksSchema.safeParse({
      links: [{ platform: "myspace", href: "https://myspace.com/x" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-URL href", () => {
    const parsed = landingSocialLinksSchema.safeParse({
      links: [{ platform: "twitter", href: "not-a-url" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("caps the list at 12 entries", () => {
    const links = Array.from({ length: 13 }, () => ({
      platform: "twitter" as const,
      href: "https://twitter.com/x",
    }));
    const parsed = landingSocialLinksSchema.safeParse({ links });
    expect(parsed.success).toBe(false);
  });
});

describe("getLandingSocialLinks — reader", () => {
  it("returns DEFAULT_SOCIAL_LINKS in sample-data mode without touching the DB", async () => {
    mocks.isLiveDb.mockReturnValue(false);
    const result = await getLandingSocialLinks();
    expect(result).toEqual(DEFAULT_SOCIAL_LINKS);
    expect(mocks.getSystemConfigValue).not.toHaveBeenCalled();
  });

  it("returns DEFAULT_SOCIAL_LINKS when the config key is missing", async () => {
    mocks.getSystemConfigValue.mockResolvedValue(null);
    const result = await getLandingSocialLinks();
    expect(result).toEqual(DEFAULT_SOCIAL_LINKS);
  });

  it("returns DEFAULT_SOCIAL_LINKS on schema drift (bad JSON stored under the key)", async () => {
    // Warning path — assert the reader is defensive, silence the noise so
    // the test output stays clean.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.getSystemConfigValue.mockResolvedValue({ links: [{ platform: "myspace" }] });

    const result = await getLandingSocialLinks();
    expect(result).toEqual(DEFAULT_SOCIAL_LINKS);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns DEFAULT_SOCIAL_LINKS when the DB read throws (blip absorbed)", async () => {
    mocks.getSystemConfigValue.mockRejectedValue(new Error("boom"));
    const result = await getLandingSocialLinks();
    expect(result).toEqual(DEFAULT_SOCIAL_LINKS);
  });

  it("returns the parsed links list on a valid config value", async () => {
    mocks.getSystemConfigValue.mockResolvedValue({
      links: [
        { platform: "twitter", href: "https://twitter.com/repodcastapp" },
        { platform: "youtube", href: "https://youtube.com/@repodcast" },
      ],
    });
    const result = await getLandingSocialLinks();
    expect(result.links).toHaveLength(2);
    expect(result.links[0]).toEqual({
      platform: "twitter",
      href: "https://twitter.com/repodcastapp",
    });
  });
});
