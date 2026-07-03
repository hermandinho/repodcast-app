import "server-only";

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

/**
 * Phase 3.2 — YouTube import via yt-dlp.
 *
 * Two paths, tried in order:
 *   1. Transcript path — pull the auto or manual captions via
 *      `yt-dlp --write-subs --write-auto-subs --skip-download --sub-format=vtt`.
 *      Fast (a few seconds), no bandwidth cost.
 *   2. Audio-fallback path — download the audio-only stream via
 *      `yt-dlp -f "bestaudio[ext=m4a]/bestaudio" -o - URL`, buffer it in
 *      memory, and hand off to the caller (who uploads to R2 + fires
 *      Deepgram). No ffmpeg needed — we always request a pre-existing
 *      audio-only stream, never a merged output.
 *
 * Why yt-dlp and not the HTML scrape the previous version used: YouTube
 * ships player-response schema changes every few months and quietly
 * breaks HTML-parsing implementations. yt-dlp is maintained weekly by
 * a large community and handles every anti-scraping evolution (client
 * hint headers, decipher signatures, live streams, age-gated content).
 *
 * `YouTubeImportError` codes:
 *   - "invalid_url"      — video id parse failed.
 *   - "not_found"        — video removed / private / region-blocked.
 *   - "no_captions"      — captions absent (caller falls back to audio).
 *   - "no_audio"         — no downloadable audio stream (deleted or
 *                          protected by DRM).
 *   - "fetch_failed"     — yt-dlp crashed or errored on a retryable
 *                          reason (network, rate limit). Retryable.
 *   - "parse_failed"     — captions returned but the VTT wasn't
 *                          parseable. Non-retryable.
 *   - "too_long"         — video exceeds `MAX_DURATION_SEC`. Non-retryable.
 */

// Resolve the binary path at runtime via the package's own constants
// export — it handles Windows/Linux differences for us. Using
// `createRequire` avoids a `require` at the module top level, which the
// project's ESLint config would flag.
const require_ = createRequire(import.meta.url);
const YT_DLP_PATH: string = (require_("yt-dlp-exec/src/constants") as { YOUTUBE_DL_PATH: string })
  .YOUTUBE_DL_PATH;

const SPAWN_TIMEOUT_MS = 60_000;
const AUDIO_SPAWN_TIMEOUT_MS = 240_000; // 4 min — audio downloads are the long tail.
const MAX_AUDIO_BYTES = 500 * 1024 * 1024;
/** Cap video length at 4 hours — anything longer risks Vercel's 5-min timeout
 *  even for a fast CDN and hurts Deepgram cost too. Users get a clean error
 *  pointing them at an RSS or manual-transcript workaround. */
const MAX_DURATION_SEC = 4 * 60 * 60;

export type YouTubeImportErrorCode =
  | "invalid_url"
  | "not_found"
  | "no_captions"
  | "no_audio"
  | "fetch_failed"
  | "parse_failed"
  | "too_long";

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
// URL parsing (unchanged from the scrape era — pure, still relevant)
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
// yt-dlp subprocess helpers
// ============================================================

type YtDlpTextResult = { stdout: string; stderr: string; code: number };
type YtDlpBinaryResult = { stdout: Buffer; stderr: string; code: number };

async function ytDlpText(args: string[], timeoutMs = SPAWN_TIMEOUT_MS): Promise<YtDlpTextResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YT_DLP_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new YouTubeImportError("fetch_failed", `yt-dlp timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    proc.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    proc.on("error", (err) => {
      clearTimeout(timer);
      // ENOENT means the binary is missing — happens on Vercel if the
      // outputFileTracingIncludes didn't pick it up.
      reject(
        new YouTubeImportError(
          "fetch_failed",
          `Couldn't spawn yt-dlp at ${YT_DLP_PATH}: ${err.message}`,
        ),
      );
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code: code ?? -1,
      });
    });
  });
}

async function ytDlpBinary(
  args: string[],
  { timeoutMs = AUDIO_SPAWN_TIMEOUT_MS, maxBytes = MAX_AUDIO_BYTES } = {},
): Promise<YtDlpBinaryResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YT_DLP_PATH, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let byteCount = 0;
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new YouTubeImportError("fetch_failed", `yt-dlp timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      byteCount += chunk.byteLength;
      if (byteCount > maxBytes) {
        proc.kill("SIGKILL");
        clearTimeout(timer);
        reject(
          new YouTubeImportError(
            "fetch_failed",
            `Audio stream exceeds ${maxBytes} bytes — refusing to buffer further.`,
          ),
        );
        return;
      }
      stdoutChunks.push(chunk);
    });
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new YouTubeImportError(
          "fetch_failed",
          `Couldn't spawn yt-dlp at ${YT_DLP_PATH}: ${err.message}`,
        ),
      );
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        code: code ?? -1,
      });
    });
  });
}

/**
 * Map yt-dlp's stderr fragments to structured error codes. yt-dlp's
 * error prose is stable enough to substring-match, and its exit code
 * alone doesn't distinguish "video removed" from "captions missing" —
 * both surface as code 1.
 */
function classifyYtDlpError(stderr: string): YouTubeImportErrorCode {
  const lower = stderr.toLowerCase();
  if (
    lower.includes("video unavailable") ||
    lower.includes("private video") ||
    lower.includes("has been removed") ||
    lower.includes("not available in your country")
  ) {
    return "not_found";
  }
  if (
    lower.includes("no subtitles") ||
    lower.includes("no automatic captions") ||
    lower.includes("there are no subtitles")
  ) {
    return "no_captions";
  }
  if (lower.includes("requested format is not available")) {
    return "no_audio";
  }
  return "fetch_failed";
}

// ============================================================
// Video metadata + duration guard
// ============================================================

export type VideoMetadata = {
  id: string;
  title: string | null;
  durationSec: number | null;
  uploader: string | null;
  captionLanguages: readonly string[];
  autoCaptionLanguages: readonly string[];
};

/**
 * `yt-dlp --dump-json --no-download` returns everything about a video
 * without touching the actual media stream. We pull it before any real
 * work so we can (a) enforce `MAX_DURATION_SEC` up front and (b) know
 * up-front whether captions exist so the transcript-first path doesn't
 * have to guess.
 */
export async function fetchYouTubeMetadata(videoId: string): Promise<VideoMetadata> {
  const args = [
    "--dump-single-json",
    "--no-warnings",
    "--no-playlist",
    "--skip-download",
    `https://www.youtube.com/watch?v=${videoId}`,
  ];
  const result = await ytDlpText(args);
  if (result.code !== 0) {
    throw new YouTubeImportError(
      classifyYtDlpError(result.stderr),
      `yt-dlp metadata fetch failed (code ${result.code}): ${result.stderr.slice(0, 300)}`,
      result.stderr,
    );
  }
  let json: {
    id: string;
    title?: string;
    duration?: number;
    uploader?: string;
    subtitles?: Record<string, unknown>;
    automatic_captions?: Record<string, unknown>;
  };
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new YouTubeImportError(
      "parse_failed",
      `yt-dlp returned non-JSON metadata: ${result.stdout.slice(0, 200)}`,
      result.stderr,
    );
  }
  return {
    id: json.id,
    title: json.title ?? null,
    durationSec: typeof json.duration === "number" ? Math.round(json.duration) : null,
    uploader: json.uploader ?? null,
    captionLanguages: json.subtitles ? Object.keys(json.subtitles) : [],
    autoCaptionLanguages: json.automatic_captions ? Object.keys(json.automatic_captions) : [],
  };
}

// ============================================================
// Caption path
// ============================================================

export type YouTubeCaptionTrack = {
  languageCode: string;
  name: string;
  isGenerated: boolean;
};

/**
 * Combine the metadata's manual + auto caption lists into a preference
 * ladder that matches what the old HTML scraper picked. Exported for
 * tests + so callers can log which track won.
 */
export function pickBestCaptionTrack(
  manual: readonly string[],
  auto: readonly string[],
): YouTubeCaptionTrack | null {
  // Manual English first.
  const manualEn = manual.find((c) => c.startsWith("en"));
  if (manualEn) return { languageCode: manualEn, name: manualEn, isGenerated: false };
  // Any manual.
  if (manual.length > 0) {
    return { languageCode: manual[0]!, name: manual[0]!, isGenerated: false };
  }
  // Auto English.
  const autoEn = auto.find((c) => c.startsWith("en"));
  if (autoEn) return { languageCode: autoEn, name: autoEn, isGenerated: true };
  // Any auto.
  if (auto.length > 0) {
    return { languageCode: auto[0]!, name: auto[0]!, isGenerated: true };
  }
  return null;
}

/**
 * Fetch the selected caption track's VTT content by asking yt-dlp for
 * the raw subtitle text. `--skip-download` keeps us off the media
 * stream; `--sub-format=vtt/ttml/srv3/best` requests VTT with fallbacks.
 * The result comes back on stdout as multi-line VTT which we parse into
 * a flat transcript.
 */
export async function fetchCaptionText(
  videoId: string,
  track: YouTubeCaptionTrack,
): Promise<string> {
  // We use --skip-download + --write-subs / --write-auto-subs but
  // redirect the output to `-` (stdout) so we don't have to touch the
  // filesystem. `--print` can pull the actual subtitle URL, then we
  // curl it — but yt-dlp's own subtitle fetcher handles retries + rate
  // limits better than a raw fetch would.
  const args = [
    "--skip-download",
    "--no-warnings",
    "--no-playlist",
    track.isGenerated ? "--write-auto-subs" : "--write-subs",
    "--sub-lang",
    track.languageCode,
    "--sub-format",
    "vtt/srv3/best",
    "-o",
    "-", // "output to stdout"
    "--quiet",
    `https://www.youtube.com/watch?v=${videoId}`,
  ];
  const result = await ytDlpText(args);
  if (result.code !== 0) {
    throw new YouTubeImportError(
      classifyYtDlpError(result.stderr),
      `Caption fetch failed (code ${result.code}): ${result.stderr.slice(0, 300)}`,
      result.stderr,
    );
  }
  const transcript = parseCaptionVtt(result.stdout);
  if (transcript.trim().length === 0) {
    throw new YouTubeImportError(
      "parse_failed",
      "yt-dlp returned an empty caption body.",
      result.stderr,
    );
  }
  return transcript;
}

/**
 * Turn a WebVTT body into a plain transcript. We ignore cue timings
 * entirely — Repodcast doesn't need alignment, just the text — and
 * collapse repeated whitespace so the result is one clean run of prose.
 *
 * VTT auto-caption output includes progressive-word-highlight tags
 * like `<00:00:03.360><c> hello</c>` inside a cue line. We strip
 * everything inside `<...>` and their `</c>` closers before de-duping.
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
    // Cue timings: "00:00:00.000 --> 00:00:04.000 align:start ..."
    if (line.includes("-->")) continue;
    // Numeric cue id lines.
    if (/^\d+$/.test(line)) continue;
    const cleaned = line
      // Strip `<00:00:03.360>` timing tags and their `<c>...</c>` wrappers.
      .replace(/<[^>]*>/g, "")
      .trim();
    if (cleaned.length === 0) continue;
    // YouTube auto-captions repeat each phrase — once as a bare line and
    // once inside a `<c>...</c>` wrapper on the next cue. De-dupe adjacent
    // identical lines.
    if (cleaned === prev) continue;
    out.push(cleaned);
    prev = cleaned;
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

// ============================================================
// Audio-fallback path
// ============================================================

export type YouTubeAudioResult = {
  buffer: Buffer;
  contentType: string;
  filename: string;
};

/**
 * Download the video's audio-only stream. We deliberately request
 * `bestaudio[ext=m4a]/bestaudio` — a pre-existing audio-only container —
 * so yt-dlp never needs ffmpeg to merge streams. Deepgram accepts m4a
 * and webm/opus natively so the raw stream can go straight to
 * transcription.
 *
 * Streams to a Buffer in memory (capped at 500MB, same ceiling the RSS
 * import uses). For a typical 60-min podcast the audio is 30-50MB and
 * the whole call finishes in 30-60 seconds on Vercel's Pro tier.
 */
export async function downloadYouTubeAudio(videoId: string): Promise<YouTubeAudioResult> {
  const args = [
    "-f",
    "bestaudio[ext=m4a]/bestaudio",
    "-o",
    "-", // pipe to stdout
    "--no-warnings",
    "--no-playlist",
    "--quiet",
    `https://www.youtube.com/watch?v=${videoId}`,
  ];
  const result = await ytDlpBinary(args);
  if (result.code !== 0 || result.stdout.byteLength === 0) {
    throw new YouTubeImportError(
      classifyYtDlpError(result.stderr),
      `Audio download failed (code ${result.code}): ${result.stderr.slice(0, 300)}`,
      result.stderr,
    );
  }
  // Sniff the container from the first few bytes to pick the right
  // content-type. Deepgram is content-type-tolerant but R2 sends it
  // through when the object is later fetched, so labeling correctly
  // saves a header round-trip.
  const contentType = sniffAudioContentType(result.stdout);
  const filename = `youtube-${videoId}.${contentTypeExt(contentType)}`;
  return { buffer: result.stdout, contentType, filename };
}

function sniffAudioContentType(buf: Buffer): string {
  // m4a / mp4: bytes 4-8 are "ftyp"
  if (buf.length >= 8 && buf.subarray(4, 8).toString("ascii") === "ftyp") {
    return "audio/mp4";
  }
  // webm / matroska: starts with 0x1A45DFA3
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return "audio/webm";
  }
  // opus in OGG container: starts with "OggS"
  if (buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === "OggS") {
    return "audio/ogg";
  }
  // mp3: starts with "ID3" or 0xFF 0xFB
  if (
    (buf.length >= 3 && buf.subarray(0, 3).toString("ascii") === "ID3") ||
    (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
  ) {
    return "audio/mpeg";
  }
  return "application/octet-stream";
}

function contentTypeExt(contentType: string): string {
  switch (contentType) {
    case "audio/mp4":
      return "m4a";
    case "audio/webm":
      return "webm";
    case "audio/ogg":
      return "opus";
    case "audio/mpeg":
      return "mp3";
    default:
      return "bin";
  }
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

export { MAX_DURATION_SEC, MAX_AUDIO_BYTES, YT_DLP_PATH };
