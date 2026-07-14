import "server-only";

/**
 * Thin client for the ffmpeg render worker running on a VPS
 * behind Cloudflare Tunnel. Prod points at `render.repodcastapp.com`,
 * previews at `render-staging.repodcastapp.com` (both configured via
 * `RENDER_WORKER_URL` on the deploy target).
 *
 * The worker exposes:
 *   GET  /healthz              — unauthenticated, returns liveness + version
 *   POST /render/clip          — bearer-auth, cuts a highlight clip from a source
 *   POST /render/audiogram     — bearer-auth, waveform video from audio + srt
 *
 * `/render/*` endpoints currently return 501; they land with the ffmpeg
 * pipeline later. Types below are the contract we're committing to
 * so caller-side wiring (Inngest bridges, server actions) can compile.
 *
 * All calls share a 30 s AbortController timeout and single-try semantics.
 * Retry lives in Inngest (`step.run`), not here — a duplicated render is
 * expensive, so we don't want casual retries under the caller's feet.
 */

const RENDER_WORKER_URL = process.env.RENDER_WORKER_URL;
const WORKER_SHARED_SECRET = process.env.WORKER_SHARED_SECRET;
const REQUEST_TIMEOUT_MS = 30_000;

export class RenderWorkerError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`RenderWorker ${status}: ${body.slice(0, 200)}`);
    this.name = "RenderWorkerError";
    this.status = status;
    this.body = body;
  }
}

export class RenderWorkerConfigError extends Error {
  constructor(missing: string) {
    super(`RenderWorker is not configured — missing ${missing}`);
    this.name = "RenderWorkerConfigError";
  }
}

// ---------------------------------------------------------------------------
// Public shapes — the contract the worker will honor once endpoints ship
// ---------------------------------------------------------------------------

export type WorkerHealth = {
  ok: boolean;
  env: string;
  uptime: number;
  version: string;
};

export type RenderClipRequest = {
  /** VideoClip.id — worker echoes this back in the response */
  clipId: string;
  /** Fully-qualified URL: R2 presigned for uploads, or YouTube watch URL */
  sourceUrl: string;
  /** Start of the highlight, ms into the source */
  startMs: number;
  /** End of the highlight, ms into the source (exclusive) */
  endMs: number;
  /** Deepgram SRT for burn-in captions. Aligned to source timeline, not clip timeline. */
  captionsSrt: string;
  /** Target aspect ratio */
  aspect: "9:16" | "1:1" | "16:9";
  /** R2 object key prefix for outputs (worker writes {prefix}/clip.mp4 + {prefix}/poster.jpg) */
  outputPrefix: string;
};

export type RenderClipResponse = {
  clipId: string;
  renderedUrl: string;
  posterUrl: string;
  durationMs: number;
  bytes: number;
};

export type RenderAudiogramRequest = {
  outputId: string;
  audioUrl: string;
  startMs: number;
  endMs: number;
  captionsSrt: string;
  aspect: "1:1" | "9:16";
  /** Show artwork URL — used as blurred background. Null = solid color. */
  backgroundImageUrl: string | null;
  outputPrefix: string;
};

export type RenderAudiogramResponse = {
  outputId: string;
  renderedUrl: string;
  posterUrl: string;
  durationMs: number;
  bytes: number;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isRenderWorkerConfigured(): boolean {
  return Boolean(RENDER_WORKER_URL && WORKER_SHARED_SECRET);
}

export async function checkHealth(): Promise<WorkerHealth> {
  return call<WorkerHealth>("GET", "/healthz", undefined, { authenticated: false });
}

export async function renderClip(request: RenderClipRequest): Promise<RenderClipResponse> {
  return call<RenderClipResponse>("POST", "/render/clip", request);
}

export async function renderAudiogram(
  request: RenderAudiogramRequest,
): Promise<RenderAudiogramResponse> {
  return call<RenderAudiogramResponse>("POST", "/render/audiogram", request);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function call<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  options: { authenticated?: boolean } = {},
): Promise<T> {
  if (!RENDER_WORKER_URL) throw new RenderWorkerConfigError("RENDER_WORKER_URL");
  const authenticated = options.authenticated ?? true;
  if (authenticated && !WORKER_SHARED_SECRET) {
    throw new RenderWorkerConfigError("WORKER_SHARED_SECRET");
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authenticated) headers.authorization = `Bearer ${WORKER_SHARED_SECRET}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${RENDER_WORKER_URL.replace(/\/$/, "")}${path}`;
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) throw new RenderWorkerError(res.status, text);
    return text ? (JSON.parse(text) as T) : ({} as T);
  } finally {
    clearTimeout(timeout);
  }
}
