/**
 * `system-config-catalog` powers the `/root/config` visibility surface. Two
 * behaviors matter to operators:
 *
 *   - `validateConfigValue` runs the catalog entry's schema against the
 *     stored value and returns one issue per Zod problem. When the reader
 *     silently falls back to defaults, this is how the ROOT UI tells the
 *     operator *why*.
 *
 *   - `mergeKnownConfigStatus` folds persisted-row state + validation into
 *     each entry so the page can render "configured", "misconfigured", or
 *     "not set" in one pass.
 */

import { describe, expect, it } from "vitest";
import {
  findKnownConfig,
  KNOWN_SYSTEM_CONFIG,
  mergeKnownConfigStatus,
  validateConfigValue,
} from "@/lib/system-config-catalog";

describe("validateConfigValue", () => {
  it("returns [] when the entry has no schema (ad-hoc keys stay silent)", () => {
    const bare = { ...KNOWN_SYSTEM_CONFIG[0], schema: undefined };
    expect(validateConfigValue(bare, { anything: true })).toEqual([]);
  });

  it("returns [] when the value satisfies the catalog schema", () => {
    const entry = findKnownConfig("LANDING_SOCIAL_LINKS")!;
    const result = validateConfigValue(entry, {
      links: [{ platform: "twitter", href: "https://twitter.com/repodcastapp" }],
    });
    expect(result).toEqual([]);
  });

  it("names each schema issue with its path + Zod message", () => {
    const entry = findKnownConfig("LANDING_SOCIAL_LINKS")!;
    const result = validateConfigValue(entry, {
      links: [{ platform: "myspace", href: "not-a-url" }],
    });
    expect(result.length).toBeGreaterThanOrEqual(2);
    // The path should point at the offending field so an operator can find
    // it without hand-parsing the whole document.
    const paths = result.map((r) => r.path).sort();
    expect(paths).toContain("links.0.platform");
    expect(paths).toContain("links.0.href");
    // The messages come straight from Zod — assert they mention the
    // problem in human-readable terms.
    const messages = result.map((r) => r.message).join(" | ");
    expect(messages).toMatch(/URL|url/);
  });

  it("returns issues for a completely wrong shape (missing links wrapper)", () => {
    const entry = findKnownConfig("LANDING_SOCIAL_LINKS")!;
    const result = validateConfigValue(entry, [{ platform: "twitter", href: "https://x.com" }]);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("mergeKnownConfigStatus", () => {
  it("marks a configured key with a valid value as configured + no issues", () => {
    const merged = mergeKnownConfigStatus([
      {
        key: "LANDING_SOCIAL_LINKS",
        value: {
          links: [{ platform: "twitter", href: "https://twitter.com/x" }],
        },
      },
    ]);
    const entry = merged.find((e) => e.key === "LANDING_SOCIAL_LINKS")!;
    expect(entry.isConfigured).toBe(true);
    expect(entry.issues).toEqual([]);
  });

  it("marks a configured key with a bad value as configured + issues", () => {
    const merged = mergeKnownConfigStatus([
      {
        key: "LANDING_SOCIAL_LINKS",
        value: { links: [{ platform: "myspace", href: "nope" }] },
      },
    ]);
    const entry = merged.find((e) => e.key === "LANDING_SOCIAL_LINKS")!;
    expect(entry.isConfigured).toBe(true);
    expect(entry.issues.length).toBeGreaterThan(0);
  });

  it("marks an absent key as not configured, no issues (nothing to validate)", () => {
    const merged = mergeKnownConfigStatus([]);
    const entry = merged.find((e) => e.key === "LANDING_SOCIAL_LINKS")!;
    expect(entry.isConfigured).toBe(false);
    expect(entry.issues).toEqual([]);
  });
});
