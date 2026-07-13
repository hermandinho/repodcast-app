/**
 * Friendly clip-render error translations.
 *
 * `VideoClip.renderError` holds the raw error thrown by the render worker
 * (ffmpeg stderr, ytdl exception, R2 upload failure). The UI shows that
 * verbatim as a fallback, but for the common cases we can translate to
 * something an agency reviewer can act on without knowing what ffmpeg
 * is.
 *
 * Match on the LOWERCASED error string against a small ordered rule
 * table — first match wins. Order matters because generic patterns
 * ("failed") would otherwise swallow specific ones ("video unavailable").
 */

type Rule = { match: RegExp; friendly: string; hint?: string };

const RULES: Rule[] = [
  // ---- YouTube-side blocks ----
  {
    match: /video unavailable/i,
    friendly: "YouTube isn't letting us access this video.",
    hint: "Datacenter IPs are frequently blocked. Try uploading the source file directly.",
  },
  {
    match: /sign in to confirm/i,
    friendly: "YouTube is asking us to prove we're not a bot.",
    hint: "Upload the video file directly to bypass this.",
  },
  {
    match: /private video/i,
    friendly: "This YouTube video is private.",
    hint: "Make the video public or unlisted, or upload the file directly.",
  },
  {
    match: /age.?restrict/i,
    friendly: "YouTube age-gates this video.",
    hint: "Upload the video file directly to bypass age verification.",
  },
  // ---- Direct-fetch source problems ----
  // Order matters: 404 before 403 because we want the more actionable
  // "the file is gone" message to win.
  {
    match: /source fetch failed: 404/i,
    friendly: "The source video is gone.",
    hint: "The link 404s. Re-import the episode from source.",
  },
  {
    match: /source fetch failed: 403/i,
    friendly: "The source video URL is refusing our request.",
    hint: "The link may have expired. Re-import the episode.",
  },
  {
    match: /source fetch failed/i,
    friendly: "We couldn't download the source video.",
    hint: "Check the source URL is still reachable, then retry.",
  },
  // ---- ffmpeg-side problems ----
  {
    match: /no video stream|invalid data found when processing input/i,
    friendly: "This file doesn't have a video track.",
    hint: "Clip generation needs video. Audio-only episodes will get audiogram support later this quarter.",
  },
  {
    match: /moov atom not found|invalid moov/i,
    friendly: "The source file appears corrupted.",
    hint: "Re-upload the source file.",
  },
  // ---- Worker infrastructure ----
  // Match on the HTTP status embedded in RenderWorkerError.message: shape
  // is `RenderWorker <status>: <body>` (see server/media/render-worker.ts).
  {
    match: /RenderWorker 5\d\d/i,
    friendly: "The render worker hit a temporary error.",
    hint: "Retry usually works.",
  },
  {
    match: /RenderWorker 4\d\d/i,
    friendly: "The render worker rejected the request.",
    hint: "This is a bug — please report it.",
  },
  {
    match: /is not configured/i,
    friendly: "Clip generation isn't fully configured.",
    hint: "Contact support — the render worker credentials are missing.",
  },
  {
    match: /timeout|timed out|ETIMEDOUT/i,
    friendly: "The render took too long and was cancelled.",
    hint: "Try a shorter clip (under 60 seconds), or retry.",
  },
];

export type ClipRenderErrorTranslation = {
  friendly: string;
  hint?: string;
  raw: string;
};

export function translateClipRenderError(raw: string | null): ClipRenderErrorTranslation | null {
  if (!raw) return null;
  for (const rule of RULES) {
    if (rule.match.test(raw)) {
      return { friendly: rule.friendly, hint: rule.hint, raw };
    }
  }
  return { friendly: "The clip failed to render.", hint: raw.slice(0, 140), raw };
}
