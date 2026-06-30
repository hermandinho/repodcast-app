import { describe, expect, it } from "vitest";
import { Platform } from "@prisma/client";
import {
  escapeHtml,
  exportFilenameFor,
  renderBrandedExport,
  sanitiseHexColor,
  type BrandedExportData,
} from "@/lib/branded-export";

const APPROVED_AT = new Date("2026-06-24T15:00:00Z");
const RECORDED_AT = new Date("2026-06-20T15:00:00Z");

const baseData: BrandedExportData = {
  episodeTitle: "Why your first 10 hires define everything",
  showName: "The Founders Frequency",
  hostName: "Maya Chen",
  recordedAt: RECORDED_AT,
  agencyName: "Northbeam Studio",
  brandLogoUrl: null,
  brandAccentColor: null,
  outputs: [
    {
      platform: Platform.LINKEDIN,
      content: "Hiring is the source code your culture compiles against.",
      approvedAt: APPROVED_AT,
    },
  ],
};

describe("escapeHtml", () => {
  it("escapes the five structural characters", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>5 & 6</a>`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;5 &amp; 6&lt;/a&gt;",
    );
  });

  it("leaves benign text unchanged", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

describe("sanitiseHexColor", () => {
  it("accepts the 7-char hex shape (case-insensitive) and lowercases", () => {
    expect(sanitiseHexColor("#3A5BA0")).toBe("#3a5ba0");
    expect(sanitiseHexColor("#3a5ba0")).toBe("#3a5ba0");
  });

  it("rejects anything else as null (forces fallback to the default accent)", () => {
    expect(sanitiseHexColor(null)).toBeNull();
    expect(sanitiseHexColor("")).toBeNull();
    expect(sanitiseHexColor("3A5BA0")).toBeNull();
    expect(sanitiseHexColor("#3A5B")).toBeNull();
    expect(sanitiseHexColor("javascript:alert(1)")).toBeNull();
    expect(sanitiseHexColor("#3A5BA0; color:red")).toBeNull();
  });
});

describe("exportFilenameFor", () => {
  it("uses the title, capped at 60 chars, with .html appended", () => {
    expect(exportFilenameFor("Episode 1")).toBe("Episode 1.html");
  });

  it("strips filesystem-hostile characters", () => {
    expect(exportFilenameFor('a/b\\c:d*e?f"g<h>i|j')).toBe("abcdefghij.html");
  });

  it("collapses whitespace and trims to 60 chars", () => {
    const long = "  spaced  out  ".padEnd(120, "x");
    const result = exportFilenameFor(long);
    expect(result.endsWith(".html")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(60 + ".html".length);
  });

  it("falls back to `episode.html` when the title is empty after sanitisation", () => {
    expect(exportFilenameFor("///")).toBe("episode.html");
    expect(exportFilenameFor("")).toBe("episode.html");
  });
});

describe("renderBrandedExport", () => {
  it("emits a complete HTML document with the title + show + agency name", () => {
    const html = renderBrandedExport(baseData);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain(
      "<title>Why your first 10 hires define everything — Northbeam Studio</title>",
    );
    expect(html).toContain("The Founders Frequency");
    expect(html).toContain("Hosted by Maya Chen");
    expect(html).toContain("Delivered by Northbeam Studio");
  });

  it("renders the logo when set, falls back to initials avatar when null", () => {
    const withLogo = renderBrandedExport({
      ...baseData,
      brandLogoUrl: "https://cdn.example.com/agency.png",
    });
    expect(withLogo).toContain('<img src="https://cdn.example.com/agency.png"');
    // No fallback DIV is rendered when a logo URL is present (the CSS
    // rule lives in <style> regardless, so we check for the element).
    expect(withLogo).not.toContain('class="logo-fallback"');

    const withoutLogo = renderBrandedExport({ ...baseData, brandLogoUrl: null });
    expect(withoutLogo).toContain('class="logo-fallback"');
    // Initials from the agency name ("Northbeam Studio" → "NO").
    expect(withoutLogo).toContain(">NO<");
  });

  it("applies the accent color when valid; uses the default otherwise", () => {
    const valid = renderBrandedExport({ ...baseData, brandAccentColor: "#a06d12" });
    expect(valid).toContain("#a06d12");

    const invalid = renderBrandedExport({ ...baseData, brandAccentColor: "not-a-color" });
    expect(invalid).toContain("#3A5BA0"); // default
    expect(invalid).not.toContain("not-a-color");
  });

  it("escapes output content so a malicious approval can't break out of the card", () => {
    const html = renderBrandedExport({
      ...baseData,
      outputs: [
        {
          platform: Platform.TWITTER,
          content: "<script>alert('xss')</script>",
          approvedAt: APPROVED_AT,
        },
      ],
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
  });

  it("escapes the episode title + show name + host name + agency name", () => {
    const html = renderBrandedExport({
      ...baseData,
      episodeTitle: "Why <hosts> matter & how",
      showName: "Show & Tell",
      hostName: "M <Chen>",
      agencyName: "Acme & Co",
    });
    expect(html).toContain("Why &lt;hosts&gt; matter &amp; how");
    expect(html).toContain("Show &amp; Tell");
    expect(html).toContain("M &lt;Chen&gt;");
    expect(html).toContain("Acme &amp; Co");
    // And not the raw HTML.
    expect(html).not.toMatch(/Why <hosts>/);
  });

  it("renders the empty state when no outputs are present", () => {
    const html = renderBrandedExport({ ...baseData, outputs: [] });
    expect(html).toContain("No approved outputs to deliver yet.");
  });

  it("omits the recorded-at line when the episode has no recorded date", () => {
    const html = renderBrandedExport({ ...baseData, recordedAt: null });
    expect(html).not.toMatch(/Recorded /);
    // Host line still renders.
    expect(html).toContain("Hosted by Maya Chen");
  });

  it("renders each output's platform display name + approved-at pill", () => {
    const html = renderBrandedExport({
      ...baseData,
      outputs: [
        { platform: Platform.LINKEDIN, content: "li body", approvedAt: APPROVED_AT },
        { platform: Platform.SHOW_NOTES, content: "notes body", approvedAt: null },
      ],
    });
    expect(html).toContain("LinkedIn Post");
    expect(html).toContain("Show Notes");
    // The non-approved row shouldn't render an approved pill.
    const showNotesIdx = html.indexOf("Show Notes");
    const slice = html.slice(showNotesIdx, showNotesIdx + 500);
    expect(slice).not.toContain("approved-pill");
  });
});
