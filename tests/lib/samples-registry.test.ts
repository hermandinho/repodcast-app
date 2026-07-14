import { describe, expect, it } from "vitest";
import { listSampleSlugs, resolveSample, SAMPLE_REGISTRY } from "@/lib/samples/registry";

describe("samples registry", () => {
  it("lists all curated slugs", () => {
    const slugs = listSampleSlugs();
    expect(slugs.length).toBeGreaterThan(0);
    expect(new Set(slugs)).toEqual(new Set(Object.keys(SAMPLE_REGISTRY)));
  });

  it("returns null for an unknown slug", () => {
    expect(resolveSample("does-not-exist")).toBeNull();
    expect(resolveSample("")).toBeNull();
  });

  it("resolves the founders-frequency sample end-to-end", () => {
    const sample = resolveSample("founders-frequency");
    expect(sample).not.toBeNull();
    // Show + voice fixtures are wired.
    expect(sample?.show.key).toBe("ff");
    expect(sample?.show.name).toBe("The Founder's Frequency");
    expect(sample?.voice.description.length).toBeGreaterThan(0);
    // Episode outputs are the seven real platform posts.
    expect(sample?.outputs.length).toBe(7);
    // Marketing tiles are present.
    expect(sample?.clips.length).toBeGreaterThan(0);
    expect(sample?.artwork.length).toBe(3);
    expect(sample?.audiograms.length).toBeGreaterThan(0);
  });

  it("every registry entry references a valid show, voice profile, and episode", () => {
    // Guards against a future edit that adds a slug pointing at a
    // missing showKey — the resolver would return null and the samples
    // route would 404 in prod without a failing test.
    for (const slug of listSampleSlugs()) {
      const sample = resolveSample(slug);
      expect(sample, `slug=${slug} should resolve`).not.toBeNull();
    }
  });

  it("artwork tiles cover all three aspect ratios", () => {
    const sample = resolveSample("founders-frequency");
    const aspects = sample?.artwork.map((a) => a.aspect) ?? [];
    expect(new Set(aspects)).toEqual(new Set(["16:9", "1:1", "9:16"]));
  });
});
