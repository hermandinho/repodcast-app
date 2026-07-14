import "server-only";

/**
 * YouTube import client.
 *
 * yt-dlp runs on the self-hosted render worker (`worker/src/lib/youtube.ts`)
 * rather than on Vercel — YouTube's datacenter-IP anti-bot check blocks
 * Vercel's egress but the worker's VPS egress is untouched. This module
 * is now a thin HTTP client that talks to `POST /import/youtube/{metadata,
 * captions,audio}` on the render worker.
 *
 * Public API is kept identical to the previous subprocess-based
 * implementation so `inngest/functions/import-youtube-episode.ts` and the
 * existing tests (`tests/server/imports/youtube.test.ts`) don't need
 * changes — except `downloadYouTubeAudio`, which now takes a `keyPrefix`
 * + `maxBytes` and returns the R2 key the worker already wrote to (no
 * more shuffling the audio buffer through Vercel).
 *
 * `YouTubeImportError` codes:
 *   - "invalid_url"      — video id parse failed.
 *   - "not_found"        — video removed / private / region-blocked.
 *   - "no_captions"      — captions absent (caller falls back to audio).
 *   - "no_audio"         — no downloadable audio stream (deleted or
 *                          protected by DRM).
 *   - "fetch_failed"     — worker crashed, network error, or rate limit.
 *                          Retryable.
 *   - "parse_failed"     — captions returned but the VTT wasn't
 *                          parseable. Non-retryable.
 *   - "too_long"         — video exceeds `MAX_DURATION_SEC`. Non-retryable.
 *   - "bot_challenge"    — YouTube demanded "Sign in to confirm you're
 *                          not a bot". Means the worker's PO provider
 *                          sidecar is misconfigured or its tokens got
 *                          rejected — retrying won't help. Non-retryable.
 */

const RENDER_WORKER_URL = process.env.RENDER_WORKER_URL;
const WORKER_SHARED_SECRET = process.env.WORKER_SHARED_SECRET;

/** Cap video length at 4 hours — anything longer risks worker timeouts
 *  and Deepgram cost. Users get a clean error pointing them at RSS or
 *  manual-transcript workarounds. */
const MAX_DURATION_SEC = 4 * 60 * 60;
const MAX_AUDIO_BYTES = 500 * 1024 * 1024;

/**
 * Per-endpoint timeout budget. Metadata + captions are single yt-dlp
 * invocations on small text payloads; the audio endpoint downloads the
 * full stream + uploads to R2, so it gets the same 10-min ceiling the
 * render endpoints use.
 */
const METADATA_TIMEOUT_MS = 60_000;
const CAPTIONS_TIMEOUT_MS = 90_000;
const AUDIO_TIMEOUT_MS = 10 * 60_000;

export type YouTubeImportErrorCode =
  | "invalid_url"
  | "not_found"
  | "no_captions"
  | "no_audio"
  | "fetch_failed"
  | "parse_failed"
  | "too_long"
  | "bot_challenge";

export class YouTubeImportError extends Error {
  readonly code: YouTubeImportErrorCode;
  readonly stderr?: string;
  constructor(code: YouTubeImportErrorCode, message: string, stderr?: string) {
    super(message);
    this.name = "YouTubeImportError";
    this.code = code;
    this.stderr = stderr;
  }
}

// ============================================================
// URL parsing (pure — stays local)
// ============================================================

/**
 * Extract the YouTube video id from any of the common URL shapes users
 * paste. Duplicated in the wizard (`isPlausibleYouTubeUrl`) for
 * client-side gating; keep the two in sync when new shapes emerge.
 */
export function parseYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;

  let url: URL;
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    url = new URL(withScheme);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  const path = url.pathname;
  const searchV = url.searchParams.get("v");

  if (host === "youtu.be") {
    const seg = path.replace(/^\//, "").split("/")[0];
    if (seg && /^[A-Za-z0-9_-]{11}$/.test(seg)) return seg;
    return null;
  }
  if (host === "youtube.com" || host === "music.youtube.com") {
    if (searchV && /^[A-Za-z0-9_-]{11}$/.test(searchV)) return searchV;
    const embedMatch = path.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
    if (embedMatch) return embedMatch[1]!;
  }
  return null;
}

// ============================================================
// Types (mirror worker responses)
// ============================================================

export type VideoMetadata = {
  id: string;
  title: string | null;
  durationSec: number | null;
  uploader: string | null;
  captionLanguages: readonly string[];
  autoCaptionLanguages: readonly string[];
};

export type YouTubeCaptionTrack = {
  languageCode: string;
  name: string;
  isGenerated: boolean;
};

export type YouTubeAudioResult = {
  /** Full R2 object key that the worker uploaded to. */
  r2Key: string;
  contentType: string;
  sizeBytes: number;
};

// ============================================================
// Worker client
// ============================================================

async function callWorker<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  if (!RENDER_WORKER_URL) {
    throw new YouTubeImportError(
      "fetch_failed",
      "RENDER_WORKER_URL is not configured — YouTube import requires the render worker.",
    );
  }
  if (!WORKER_SHARED_SECRET) {
    throw new YouTubeImportError(
      "fetch_failed",
      "WORKER_SHARED_SECRET is not configured — YouTube import requires the render worker.",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = `${RENDER_WORKER_URL.replace(/\/$/, "")}${path}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${WORKER_SHARED_SECRET}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      // Worker error contract: { error: { code, message, stderr } } for
      // YouTubeImportError-shaped failures. Anything else we treat as a
      // generic fetch_failed so the Inngest retry budget picks it up.
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        // fall through
      }
      const err = extractWorkerError(parsed);
      if (err) throw err;
      throw new YouTubeImportError(
        "fetch_failed",
        `Worker responded ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    return text ? (JSON.parse(text) as T) : ({} as T);
  } catch (err) {
    if (err instanceof YouTubeImportError) throw err;
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new YouTubeImportError(
        "fetch_failed",
        `Render worker did not respond within ${Math.round(timeoutMs / 1000)}s (client abort)`,
      );
    }
    throw new YouTubeImportError("fetch_failed", err instanceof Error ? err.message : String(err));
  } finally {
    clearTimeout(timer);
  }
}

function extractWorkerError(body: unknown): YouTubeImportError | null {
  if (!body || typeof body !== "object") return null;
  const errField = (body as { error?: unknown }).error;
  if (!errField || typeof errField !== "object") return null;
  const { code, message, stderr } = errField as {
    code?: unknown;
    message?: unknown;
    stderr?: unknown;
  };
  const validCodes: readonly YouTubeImportErrorCode[] = [
    "invalid_url",
    "not_found",
    "no_captions",
    "no_audio",
    "fetch_failed",
    "parse_failed",
    "too_long",
    "bot_challenge",
  ];
  if (typeof code !== "string" || !validCodes.includes(code as YouTubeImportErrorCode)) {
    return null;
  }
  return new YouTubeImportError(
    code as YouTubeImportErrorCode,
    typeof message === "string" ? message : "YouTube import failed",
    typeof stderr === "string" ? stderr : undefined,
  );
}

// ============================================================
// Public API — same shape as the previous subprocess-based module
// ============================================================

export async function fetchYouTubeMetadata(videoId: string): Promise<VideoMetadata> {
  return callWorker<VideoMetadata>("/import/youtube/metadata", { videoId }, METADATA_TIMEOUT_MS);
}

/**
 * Combine the metadata's manual + auto caption lists into a preference
 * ladder that matches what the original HTML scraper picked. Exported for
 * tests + so callers can log which track won.
 */
export function pickBestCaptionTrack(
  manual: readonly string[],
  auto: readonly string[],
): YouTubeCaptionTrack | null {
  const manualEn = manual.find((c) => c.startsWith("en"));
  if (manualEn) return { languageCode: manualEn, name: manualEn, isGenerated: false };
  if (manual.length > 0) {
    return { languageCode: manual[0]!, name: manual[0]!, isGenerated: false };
  }
  const autoEn = auto.find((c) => c.startsWith("en"));
  if (autoEn) return { languageCode: autoEn, name: autoEn, isGenerated: true };
  if (auto.length > 0) {
    return { languageCode: auto[0]!, name: auto[0]!, isGenerated: true };
  }
  return null;
}

export async function fetchCaptionText(
  videoId: string,
  track: YouTubeCaptionTrack,
): Promise<string> {
  const res = await callWorker<{ transcript: string }>(
    "/import/youtube/captions",
    { videoId, track },
    CAPTIONS_TIMEOUT_MS,
  );
  return res.transcript;
}

/**
 * Turn a WebVTT body into a plain transcript. Kept exported for the test
 * suite — the worker parses VTT server-side now, so this function is no
 * longer on the hot path.
 */
export function parseCaptionVtt(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let prev = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.startsWith("WEBVTT")) continue;
    if (line.startsWith("NOTE")) continue;
    if (line.startsWith("Kind:") || line.startsWith("Language:")) continue;
    if (line.includes("-->")) continue;
    if (/^\d+$/.test(line)) continue;
    const cleaned = line.replace(/<[^>]*>/g, "").trim();
    if (cleaned.length === 0) continue;
    if (cleaned === prev) continue;
    out.push(cleaned);
    prev = cleaned;
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Download the video's audio-only stream via the worker and upload it to
 * R2 in one round-trip. Returns the R2 key the worker wrote — the caller
 * persists it as `Episode.audioUrl` and hands off to the transcribe
 * pipeline.
 *
 * `keyPrefix` becomes `${keyPrefix}.${ext}` server-side, where `ext` is
 * sniffed from the first bytes of the downloaded stream. Callers pass a
 * prefix without an extension (e.g. `audio/${agencyId}/${showId}/${episodeId}`).
 */
export async function downloadYouTubeAudio(
  videoId: string,
  keyPrefix: string,
): Promise<YouTubeAudioResult> {
  return callWorker<YouTubeAudioResult>(
    "/import/youtube/audio",
    { videoId, keyPrefix, maxBytes: MAX_AUDIO_BYTES },
    AUDIO_TIMEOUT_MS,
  );
}

// ============================================================
// High-level convenience
// ============================================================

export type FetchYouTubeTranscriptResult = {
  videoId: string;
  metadata: VideoMetadata;
  track: YouTubeCaptionTrack;
  transcript: string;
};

/**
 * End-to-end: parse URL → metadata → transcript. Throws
 * `YouTubeImportError { code: "no_captions" }` when no track exists so
 * the Inngest fn can fall through to the audio path.
 */
export async function fetchYouTubeTranscript(input: string): Promise<FetchYouTubeTranscriptResult> {
  const videoId = parseYouTubeVideoId(input);
  if (!videoId) {
    throw new YouTubeImportError(
      "invalid_url",
      "Couldn't recognize this as a YouTube URL. Paste a link like https://www.youtube.com/watch?v=… or https://youtu.be/…",
    );
  }
  const metadata = await fetchYouTubeMetadata(videoId);
  if (metadata.durationSec !== null && metadata.durationSec > MAX_DURATION_SEC) {
    const hours = Math.round(metadata.durationSec / 3600);
    throw new YouTubeImportError(
      "too_long",
      `Video is ${hours}h long — beyond the ${MAX_DURATION_SEC / 3600}h import cap. Use the RSS import or paste the transcript manually.`,
    );
  }
  const track = pickBestCaptionTrack(metadata.captionLanguages, metadata.autoCaptionLanguages);
  if (!track) {
    throw new YouTubeImportError(
      "no_captions",
      "This video has no captions. Turn them on in YouTube Studio (or wait for auto-captions) and try again — or Repodcast can transcribe the audio directly.",
    );
  }
  const transcript = await fetchCaptionText(videoId, track);
  return { videoId, metadata, track, transcript };
}

export { MAX_DURATION_SEC, MAX_AUDIO_BYTES };
