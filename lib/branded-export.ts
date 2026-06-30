import type { Platform } from "@prisma/client";

/**
 * Phase 2.5 — branded HTML export for a single episode's approved
 * deliverables. Renders a self-contained HTML document (inline styles,
 * no external assets except the agency logo if set) that the agency can
 * hand to their client as a "delivery receipt."
 *
 * Self-contained on purpose: the client may open this in their email
 * client, save it to disk, forward it on. We can't assume the receiver
 * has internet access to fetch a stylesheet at render time.
 *
 * Pure — takes a data shape, returns a string. The route handler is the
 * thin Next adapter around it.
 */

const DEFAULT_ACCENT = "#3A5BA0";

const PLATFORM_DISPLAY_NAME: Record<Platform, string> = {
  TWITTER: "X / Twitter Thread",
  LINKEDIN: "LinkedIn Post",
  INSTAGRAM: "Instagram Caption",
  TIKTOK: "TikTok Script",
  SHOW_NOTES: "Show Notes",
  BLOG: "Blog Post",
  NEWSLETTER: "Newsletter Issue",
};

export type BrandedExportOutput = {
  platform: Platform;
  content: string;
  approvedAt: Date | null;
};

export type BrandedExportData = {
  episodeTitle: string;
  showName: string;
  hostName: string;
  recordedAt: Date | null;
  agencyName: string;
  brandLogoUrl: string | null;
  brandAccentColor: string | null;
  outputs: BrandedExportOutput[];
};

/**
 * Escape a string for safe HTML interpolation. Covers the 5 characters
 * with structural meaning — that's the universal set for non-script
 * contexts. We never interpolate user content inside `<script>` or
 * attributes that take JavaScript URLs, so this is sufficient.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Single-line filename derivation. Strips characters that misbehave in
 * `Content-Disposition` or filesystems, collapses whitespace, caps at
 * 60 chars so the result reads cleanly in a downloads folder.
 *
 * Exported so the route handler + tests share one canonical rule.
 */
export function exportFilenameFor(episodeTitle: string): string {
  const trimmed = episodeTitle
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 60)
    .trim();
  return `${trimmed.length > 0 ? trimmed : "episode"}.html`;
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

/**
 * Render the branded HTML document. Returns a complete document with
 * a `<!doctype html>` prolog — the route handler passes the result
 * straight into a Response body.
 */
export function renderBrandedExport(data: BrandedExportData): string {
  const accent = sanitiseHexColor(data.brandAccentColor) ?? DEFAULT_ACCENT;
  const accentSoft = `${accent}1A`; // ~10 % alpha tint for accent backgrounds

  const headerLogo = data.brandLogoUrl
    ? `<img src="${escapeHtml(data.brandLogoUrl)}" alt="${escapeHtml(data.agencyName)} logo" class="logo" />`
    : `<div class="logo-fallback" style="background:${accent}">${escapeHtml(
        data.agencyName.slice(0, 2).toUpperCase(),
      )}</div>`;

  const recordedLine = data.recordedAt
    ? `<div class="meta">Recorded ${DATE_FMT.format(data.recordedAt)} · Hosted by ${escapeHtml(
        data.hostName,
      )}</div>`
    : `<div class="meta">Hosted by ${escapeHtml(data.hostName)}</div>`;

  const outputsHtml =
    data.outputs.length === 0
      ? `<div class="empty">No approved outputs to deliver yet.</div>`
      : data.outputs.map((o) => renderOutputCard(o, accent, accentSoft)).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(data.episodeTitle)} — ${escapeHtml(data.agencyName)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif;
    background: #F4F6FB;
    color: #1A2A4A;
    line-height: 1.55;
  }
  .page { max-width: 760px; margin: 0 auto; padding: 40px 24px 80px; }
  header { display: flex; align-items: center; gap: 14px; margin-bottom: 28px; }
  .logo, .logo-fallback {
    width: 52px; height: 52px; border-radius: 10px; flex-shrink: 0;
    object-fit: cover; background: #EEF1F6;
  }
  .logo-fallback {
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 700; font-size: 16px;
  }
  .eyebrow {
    font-size: 11px; font-weight: 700; letter-spacing: .06em;
    text-transform: uppercase; color: #7A8496;
  }
  h1 {
    margin: 4px 0 6px; font-size: 24px; font-weight: 600; color: #1A2A4A;
  }
  .meta { color: #7A8496; font-size: 13px; }
  .show {
    font-size: 13px; color: #5A6473; margin-top: 4px;
  }
  .card {
    background: #FFFFFF;
    border: 1px solid #E6EBF3;
    border-radius: 14px;
    padding: 20px;
    margin-bottom: 14px;
    box-shadow: 0 1px 2px rgba(26,42,74,.04);
  }
  .card-head {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; margin-bottom: 12px;
  }
  .platform { font-weight: 600; font-size: 14px; color: #1A2A4A; }
  .approved-pill {
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }
  .content {
    background: #FBFCFE;
    border-radius: 10px;
    padding: 14px 16px;
    font-size: 13px;
    line-height: 1.6;
    color: #2A3550;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .empty {
    background: #FFFFFF; border: 1px dashed #C9D4E8; border-radius: 14px;
    padding: 32px; text-align: center; color: #7A8496; font-size: 13px;
  }
  footer {
    margin-top: 36px; text-align: center; font-size: 11px; color: #A6AEBD;
  }
  @media print {
    body { background: #FFFFFF; }
    .card { box-shadow: none; }
  }
</style>
</head>
<body>
  <div class="page">
    <header>
      ${headerLogo}
      <div>
        <div class="eyebrow">Delivered by ${escapeHtml(data.agencyName)}</div>
        <h1>${escapeHtml(data.episodeTitle)}</h1>
        <div class="show">${escapeHtml(data.showName)}</div>
        ${recordedLine}
      </div>
    </header>
    ${outputsHtml}
    <footer>Approved deliverables for ${escapeHtml(data.showName)} · powered by ${escapeHtml(data.agencyName)}</footer>
  </div>
</body>
</html>`;
}

function renderOutputCard(o: BrandedExportOutput, accent: string, accentSoft: string): string {
  const approvedPill = o.approvedAt
    ? `<span class="approved-pill" style="background:${accentSoft};color:${accent}">Approved ${escapeHtml(
        DATE_FMT.format(o.approvedAt),
      )}</span>`
    : "";
  return `<article class="card">
  <div class="card-head">
    <div class="platform">${escapeHtml(PLATFORM_DISPLAY_NAME[o.platform] ?? o.platform)}</div>
    ${approvedPill}
  </div>
  <div class="content">${escapeHtml(o.content)}</div>
</article>`;
}

/**
 * Defence against a malicious / malformed `brandAccentColor` from the DB
 * (the agency column is free-form String). Returns the value when it
 * matches the strict 7-char hex shape, otherwise null so the renderer
 * falls back to the default. This is the only place the color is
 * inlined into a `style="..."` attribute, so the gate has to live here.
 */
export function sanitiseHexColor(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : null;
}
