import { spawn } from "node:child_process";
import { open } from "node:fs/promises";

/**
 * Worker-side yt-dlp helpers. Ported from `server/imports/youtube.ts` on
 * the Next.js app; the app now calls the worker over HTTP instead of
 * spawning yt-dlp itself, so YouTube sees a non-Vercel egress IP and the
 * datacenter-IP anti-bot check no longer trips.
 *
 * Every function here throws `YouTubeImportError` with a machine-readable
 * `code` so the worker endpoint can translate to a 4xx JSON body the app
 * can re-raise as the same class on its side. Codes match the app's
 * `YouTubeImportErrorCode` union 1:1 — keep them in sync when adding new
 * failure modes.
 */

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

const YT_DLP_BIN = process.env.YT_DLP_PATH ?? "yt-dlp";
const METADATA_TIMEOUT_MS = 60_000;
const CAPTION_TIMEOUT_MS = 60_000;
const AUDIO_TIMEOUT_MS = 8 * 60_000; // longer than Vercel used to allow — worker can afford it.

/**
 * BotGuard-backed PO token provider — the `bgutil-ytdlp-pot-provider`
 * plugin (installed pip-side into yt-dlp's plugin namespace) hits this
 * URL to mint tokens. Unset in dev is fine — yt-dlp still works for
 * videos that don't happen to trigger the bot gate on the current
 * egress. In prod/staging, docker-compose wires this to the sibling
 * `bgutil-provider` service.
 */
const POT_PROVIDER_URL = process.env.YT_DLP_POT_PROVIDER_URL?.replace(/\/$/, "");

/**
 * Splice `--extractor-args youtubepot-bgutilhttp:base_url=…` into a
 * yt-dlp arg list. No-op when the env var isn't set so local dev can
 * still run against a video that doesn't need the token.
 */
function withPotProviderArgs(args: string[]): string[] {
  if (!POT_PROVIDER_URL) return args;
  return [...args, "--extractor-args", `youtubepot-bgutilhttp:base_url=${POT_PROVIDER_URL}`];
}

// ============================================================
// video id validation
// ============================================================

/**
 * The app parses URLs on its side and only ever sends us the 11-char
 * video id, but we defense-in-depth here: reject anything that couldn't
 * be a real id so we don't hand attacker-controlled strings to
 * `yt-dlp` on the command line.
 */
export function validateVideoId(id: string): string {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(id)) {
    throw new YouTubeImportError("invalid_url", `Invalid YouTube video id: ${id}`);
  }
  return id;
}

// ============================================================
// yt-dlp subprocess helpers
// ============================================================

type YtDlpTextResult = { stdout: string; stderr: string; code: number };

async function ytDlpText(args: string[], timeoutMs: number): Promise<YtDlpTextResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YT_DLP_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
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
      reject(
        new YouTubeImportError(
          "fetch_failed",
          `Couldn't spawn yt-dlp (${YT_DLP_BIN}): ${err.message}`,
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

/**
 * Download yt-dlp's output straight to a file on the worker's disk. We
 * pipe the stdout of yt-dlp into a Node write stream and let ffmpeg-style
 * disk buffering carry the payload. Cleaner than in-memory buffering for
 * the 30–500 MB range typical of podcast audio.
 */
async function ytDlpToFile(
  args: string[],
  outFile: NodeJS.WritableStream,
  timeoutMs: number,
): Promise<{ stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(YT_DLP_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new YouTubeImportError("fetch_failed", `yt-dlp timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.pipe(outFile, { end: true });
    proc.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new YouTubeImportError(
          "fetch_failed",
          `Couldn't spawn yt-dlp (${YT_DLP_BIN}): ${err.message}`,
        ),
      );
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stderr: Buffer.concat(stderr).toString("utf8"), code: code ?? -1 });
    });
  });
}

/**
 * Map yt-dlp's stderr prose to a machine-readable code. yt-dlp's exit
 * code alone doesn't distinguish "video removed" from "captions missing"
 * — both surface as code 1 — so we substring-match on the stderr text.
 */
export function classifyYtDlpError(stderr: string): YouTubeImportErrorCode {
  const lower = stderr.toLowerCase();
  // Match "Sign in to confirm you're not a bot" and its recent variants.
  // Reaching this branch means the PO provider either isn't wired up, is
  // unhealthy, or its tokens are being rejected — retries won't help, we
  // want a distinct code so ops can jump to the right diagnostic.
  if (
    lower.includes("sign in to confirm you") ||
    lower.includes("confirm you're not a bot") ||
    lower.includes("confirm you are not a bot")
  ) {
    return "bot_challenge";
  }
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
// metadata
// ============================================================

export type VideoMetadata = {
  id: string;
  title: string | null;
  durationSec: number | null;
  uploader: string | null;
  captionLanguages: readonly string[];
  autoCaptionLanguages: readonly string[];
};

export async function fetchMetadata(videoId: string): Promise<VideoMetadata> {
  const id = validateVideoId(videoId);
  const result = await ytDlpText(
    withPotProviderArgs([
      "--dump-single-json",
      "--no-warnings",
      "--no-playlist",
      "--skip-download",
      `https://www.youtube.com/watch?v=${id}`,
    ]),
    METADATA_TIMEOUT_MS,
  );
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
// captions
// ============================================================

export type CaptionTrack = {
  languageCode: string;
  name: string;
  isGenerated: boolean;
};

export async function fetchCaptions(videoId: string, track: CaptionTrack): Promise<string> {
  const id = validateVideoId(videoId);
  const result = await ytDlpText(
    withPotProviderArgs([
      "--skip-download",
      "--no-warnings",
      "--no-playlist",
      track.isGenerated ? "--write-auto-subs" : "--write-subs",
      "--sub-lang",
      track.languageCode,
      "--sub-format",
      "vtt/srv3/best",
      "-o",
      "-",
      "--quiet",
      `https://www.youtube.com/watch?v=${id}`,
    ]),
    CAPTION_TIMEOUT_MS,
  );
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
 * WebVTT → flat prose. Ignores cue timings entirely (Repodcast doesn't
 * need alignment), strips YouTube's `<00:00:03.360><c> word</c>`
 * per-word highlight tags, and de-dupes adjacent identical lines that
 * auto-caption tracks emit as a "plain then wrapped" pair.
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

// ============================================================
// audio download
// ============================================================

export type DownloadedAudio = {
  /** Path on the worker's local disk. Caller is responsible for cleanup. */
  path: string;
  contentType: string;
  ext: string;
  sizeBytes: number;
};

/**
 * Ask yt-dlp for the video's audio-only stream (m4a preferred, fall back
 * to whatever it can produce without needing ffmpeg to merge). Writes the
 * bytes to `outPath` on disk — caller uploads from there.
 *
 * `--max-filesize` caps the download server-side so a giant vlog can't
 * fill the worker's `/tmp`.
 */
export async function downloadAudio(
  videoId: string,
  outPath: string,
  { maxBytes }: { maxBytes: number },
): Promise<DownloadedAudio> {
  const id = validateVideoId(videoId);
  const { createWriteStream } = await import("node:fs");
  const stream = createWriteStream(outPath);
  const streamDone = new Promise<void>((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  const result = await ytDlpToFile(
    withPotProviderArgs([
      "-f",
      "bestaudio[ext=m4a]/bestaudio",
      "--max-filesize",
      `${maxBytes}`,
      "-o",
      "-",
      "--no-warnings",
      "--no-playlist",
      "--quiet",
      `https://www.youtube.com/watch?v=${id}`,
    ]),
    stream,
    AUDIO_TIMEOUT_MS,
  );
  await streamDone;

  if (result.code !== 0) {
    throw new YouTubeImportError(
      classifyYtDlpError(result.stderr),
      `Audio download failed (code ${result.code}): ${result.stderr.slice(0, 300)}`,
      result.stderr,
    );
  }

  const { statSync } = await import("node:fs");
  const sizeBytes = statSync(outPath).size;
  if (sizeBytes === 0) {
    throw new YouTubeImportError(
      "no_audio",
      "yt-dlp produced an empty audio stream.",
      result.stderr,
    );
  }
  if (sizeBytes > maxBytes) {
    throw new YouTubeImportError(
      "fetch_failed",
      `Audio stream (${sizeBytes} bytes) exceeds the ${maxBytes}-byte cap.`,
    );
  }

  const contentType = await sniffAudioContentType(outPath);
  return { path: outPath, contentType, ext: contentTypeExt(contentType), sizeBytes };
}

/**
 * Read the first 16 bytes of the file to identify the container. m4a is
 * the dominant case (we ask for it first), but auto-fallback can hand us
 * webm/opus or an mp3.
 */
async function sniffAudioContentType(path: string): Promise<string> {
  const fd = await open(path, "r");
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await fd.read({ buffer: buf, length: 16, position: 0 });
    if (bytesRead >= 8 && buf.subarray(4, 8).toString("ascii") === "ftyp") {
      return "audio/mp4";
    }
    if (
      bytesRead >= 4 &&
      buf[0] === 0x1a &&
      buf[1] === 0x45 &&
      buf[2] === 0xdf &&
      buf[3] === 0xa3
    ) {
      return "audio/webm";
    }
    if (bytesRead >= 4 && buf.subarray(0, 4).toString("ascii") === "OggS") {
      return "audio/ogg";
    }
    if (
      (bytesRead >= 3 && buf.subarray(0, 3).toString("ascii") === "ID3") ||
      (bytesRead >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)
    ) {
      return "audio/mpeg";
    }
    return "application/octet-stream";
  } finally {
    await fd.close();
  }
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
