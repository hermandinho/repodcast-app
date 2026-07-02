import "server-only";

/**
 * Phase 3.2 — YouTube caption import.
 *
 * Strategy: no third-party dep. We fetch the video's public watch page,
 * extract the embedded `ytInitialPlayerResponse` JSON blob, pull the list
 * of caption tracks (`playerCaptionsTracklistRenderer.captionTracks`),
 * and fetch the winning track's `baseUrl` for its timedtext XML.
 *
 * Track preference order:
 *   1. Manually uploaded English (best signal — publisher-curated).
 *   2. Manually uploaded, any language.
 *   3. Auto-generated English.
 *   4. Any auto-generated track.
 *
 * Failure modes surface as `YouTubeImportError` with a machine-readable
 * `code`:
 *   - "invalid_url"      — couldn't extract a video id from the input.
 *   - "not_found"        — video page 404s (removed, private, region-blocked).
 *   - "no_captions"      — video exists but has no caption tracks. Actionable:
 *                          "turn on captions in YouTube Studio and retry".
 *   - "fetch_failed"     — network / 5xx / rate limit fetching the page or
 *                          caption baseUrl. Retryable.
 *   - "parse_failed"     — YouTube shipped a schema change we don't
 *                          understand. Non-retryable; we ship a fix instead.
 *
 * We deliberately avoid audio-fallback in v1: extracting audio from
 * YouTube requires scraping stream URLs, which YouTube actively fights.
 * That's a fragile path we'd rather not put on the hot path.
 */

const YT_WATCH_URL_BASE = "https://www.youtube.com/watch?v=";
const FETCH_TIMEOUT_MS = 15_000;

/** Chrome UA — using a bot-shaped UA gets YouTube to return a stripped
 * page without the player response we need. */
const FETCH_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type YouTubeImportErrorCode =
  "invalid_url" | "not_found" | "no_captions" | "fetch_failed" | "parse_failed";

export class YouTubeImportError extends Error {
  readonly code: YouTubeImportErrorCode;
  readonly status?: number;
  constructor(code: YouTubeImportErrorCode, message: string, status?: number) {
    super(message);
    this.name = "YouTubeImportError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Extract the YouTube video id from any of the common URL shapes users
 * paste:
 *   https://www.youtube.com/watch?v=abc123
 *   https://youtube.com/watch?v=abc123&list=xyz
 *   https://youtu.be/abc123
 *   https://youtu.be/abc123?si=tracking
 *   https://www.youtube.com/embed/abc123
 *   https://www.youtube.com/shorts/abc123
 *   https://m.youtube.com/watch?v=abc123
 *   Bare id: abc123 (11 chars, base64url)
 */
export function parseYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  // Bare video id — 11 chars, base64url alphabet.
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;

  let url: URL;
  try {
    // Prepend https:// so `youtu.be/xyz` parses (rare but happens).
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    url = new URL(withScheme);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  const path = url.pathname;
  const searchV = url.searchParams.get("v");

  if (host === "youtu.be") {
    // youtu.be/<id>
    const seg = path.replace(/^\//, "").split("/")[0];
    if (seg && /^[A-Za-z0-9_-]{11}$/.test(seg)) return seg;
    return null;
  }
  if (host === "youtube.com" || host === "music.youtube.com") {
    if (searchV && /^[A-Za-z0-9_-]{11}$/.test(searchV)) return searchV;
    // /embed/<id> or /shorts/<id> or /live/<id>
    const embedMatch = path.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
    if (embedMatch) return embedMatch[1]!;
  }
  return null;
}

export type YouTubeCaptionTrack = {
  /** Language code (e.g. "en", "es") from YouTube. */
  languageCode: string;
  /** Human-readable name YouTube returns. */
  name: string;
  /** True when this track is auto-generated ASR, not publisher-provided. */
  isGenerated: boolean;
  /** Full URL to fetch the timedtext XML for this track. */
  baseUrl: string;
};

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      headers: {
        "User-Agent": FETCH_UA,
        "Accept-Language": "en-US,en;q=0.9",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract the JSON payload YouTube embeds as
 * `ytInitialPlayerResponse = { ... };` inside the watch page HTML. The
 * pattern has been stable for years but we defensively try two shapes.
 */
function extractPlayerResponse(html: string): unknown {
  // Shape 1: `var ytInitialPlayerResponse = {...};` (older pages).
  const m1 = html.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});/);
  if (m1) {
    try {
      return JSON.parse(m1[1]!);
    } catch {
      // fall through
    }
  }
  // Shape 2: `ytInitialPlayerResponse":<json>,"` (embedded in ytcfg blob).
  const m2 = html.match(/"ytInitialPlayerResponse"\s*:\s*(\{.+?\})\s*,\s*"ytcfg/);
  if (m2) {
    try {
      return JSON.parse(m2[1]!);
    } catch {
      // fall through
    }
  }
  return null;
}

/**
 * List every caption track available on the video. Empty result means the
 * video has no captions — callers treat that as `no_captions`.
 */
export async function listCaptionTracks(videoId: string): Promise<YouTubeCaptionTrack[]> {
  let res: Response;
  try {
    res = await fetchWithTimeout(`${YT_WATCH_URL_BASE}${encodeURIComponent(videoId)}`);
  } catch (err) {
    throw new YouTubeImportError(
      "fetch_failed",
      `Couldn't reach YouTube: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (res.status === 404) {
    throw new YouTubeImportError("not_found", "Video not found (404).", 404);
  }
  if (!res.ok) {
    throw new YouTubeImportError(
      "fetch_failed",
      `YouTube returned ${res.status} ${res.statusText}`,
      res.status,
    );
  }
  const html = await res.text();
  const playerResponse = extractPlayerResponse(html);
  if (!playerResponse || typeof playerResponse !== "object") {
    // Common cause: age-restricted or region-blocked video returns a
    // stripped page.
    throw new YouTubeImportError(
      "parse_failed",
      "Couldn't extract player response from the video page. The video may be age-restricted, private, or region-blocked.",
    );
  }
  const pr = playerResponse as {
    playabilityStatus?: { status?: string; reason?: string };
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: Array<{
          baseUrl?: string;
          name?: { simpleText?: string; runs?: Array<{ text?: string }> };
          languageCode?: string;
          kind?: string;
          vssId?: string;
        }>;
      };
    };
  };
  if (pr.playabilityStatus?.status && pr.playabilityStatus.status !== "OK") {
    throw new YouTubeImportError(
      "not_found",
      `YouTube reports the video as ${pr.playabilityStatus.status}: ${pr.playabilityStatus.reason ?? "no reason given"}.`,
    );
  }
  const rawTracks = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!rawTracks || rawTracks.length === 0) {
    return [];
  }
  return rawTracks
    .filter(
      (
        t,
      ): t is {
        baseUrl: string;
        languageCode: string;
        name?: { simpleText?: string; runs?: Array<{ text?: string }> };
        kind?: string;
      } => typeof t.baseUrl === "string" && typeof t.languageCode === "string",
    )
    .map((t) => {
      const name =
        t.name?.simpleText ?? t.name?.runs?.map((r) => r.text ?? "").join("") ?? t.languageCode;
      // `kind: "asr"` is YouTube's marker for auto-speech-recognition tracks.
      return {
        languageCode: t.languageCode,
        name,
        isGenerated: t.kind === "asr",
        baseUrl: t.baseUrl,
      };
    });
}

/**
 * Given a list of caption tracks, pick the best one:
 *   1. Manual English.
 *   2. Any manual track.
 *   3. Auto English.
 *   4. First auto track.
 */
export function pickBestCaptionTrack(
  tracks: readonly YouTubeCaptionTrack[],
): YouTubeCaptionTrack | null {
  if (tracks.length === 0) return null;
  const manual = tracks.filter((t) => !t.isGenerated);
  const manualEn = manual.find((t) => t.languageCode.startsWith("en"));
  if (manualEn) return manualEn;
  if (manual.length > 0) return manual[0]!;
  const autoEn = tracks.find((t) => t.isGenerated && t.languageCode.startsWith("en"));
  if (autoEn) return autoEn;
  return tracks[0] ?? null;
}

/**
 * Fetch and normalize the captions for a given track. YouTube's default
 * response format is XML with a series of `<text start="..." dur="...">
 * escaped-text</text>` entries. We concatenate the text in order,
 * unescape HTML entities, and collapse whitespace.
 */
export async function fetchCaptionText(track: YouTubeCaptionTrack): Promise<string> {
  let res: Response;
  try {
    res = await fetchWithTimeout(track.baseUrl);
  } catch (err) {
    throw new YouTubeImportError(
      "fetch_failed",
      `Couldn't fetch caption track: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new YouTubeImportError(
      "fetch_failed",
      `Caption track fetch returned ${res.status}`,
      res.status,
    );
  }
  const xml = await res.text();
  return parseCaptionXml(xml);
}

/**
 * Parse the timedtext XML into a plain-text transcript. We don't need a
 * proper XML parser — the format is a flat list of `<text ...>...</text>`
 * elements, no nesting.
 */
export function parseCaptionXml(xml: string): string {
  const parts: string[] = [];
  // Match every <text ...>...</text> block; be permissive about the
  // attribute order + optional trailing space.
  const re = /<text\b[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1] ?? "";
    parts.push(unescapeXmlEntities(raw));
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Decode the handful of HTML entities YouTube emits in caption text.
 * Deliberately narrow — we don't run untrusted HTML through an entity
 * decoder that could pull in named entity tables etc.
 */
function unescapeXmlEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&#34;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number.parseInt(String(code), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _;
    });
}

/**
 * High-level convenience: parse a URL, fetch tracks, pick the best,
 * fetch + return the text. Throws `YouTubeImportError` on every failure
 * path. This is what the Inngest function calls.
 */
export async function fetchYouTubeTranscript(input: string): Promise<{
  videoId: string;
  track: YouTubeCaptionTrack;
  transcript: string;
}> {
  const videoId = parseYouTubeVideoId(input);
  if (!videoId) {
    throw new YouTubeImportError(
      "invalid_url",
      "Couldn't recognize this as a YouTube URL. Paste a link like https://www.youtube.com/watch?v=… or https://youtu.be/…",
    );
  }
  const tracks = await listCaptionTracks(videoId);
  const track = pickBestCaptionTrack(tracks);
  if (!track) {
    throw new YouTubeImportError(
      "no_captions",
      "This video doesn't have any captions. Turn them on in YouTube Studio (or wait for auto-captions to generate) and try again.",
    );
  }
  const transcript = await fetchCaptionText(track);
  return { videoId, track, transcript };
}
