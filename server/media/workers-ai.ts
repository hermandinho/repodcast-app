import "server-only";

/**
 * Q1 feature #4 — Cloudflare Workers AI client.
 *
 * We only use the image-generation surface (flux-1-schnell). REST is fine
 * — no streaming, no websockets — so we skip Cloudflare's SDK to keep
 * the Next bundle small.
 *
 * Endpoint shape:
 *   POST https://api.cloudflare.com/client/v4/accounts/{acct}/ai/run/{model}
 *   Auth: Bearer <CLOUDFLARE_WORKERS_AI_TOKEN>
 *   Body: { prompt, num_steps?, seed?, width?, height? }
 *   Response: Binary PNG in body (Content-Type: image/png).
 *
 * flux-1-schnell is the "fast" Flux variant — ~2s per image, decent
 * quality, weak on text overlays. Good enough for hero backgrounds.
 * For text-heavy YouTube thumbnails we'd want ideogram or gpt-image-1,
 * both deferred to when quality becomes a churn signal.
 *
 * Free tier: 10k neurons/day. One flux-1-schnell call ≈ 20 neurons, so
 * ~500 requests/day free. Enough for hundreds of episodes.
 */

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

/** All Workers AI image models expose the same request shape. */
export type WorkersAiImageModel =
  "@cf/black-forest-labs/flux-1-schnell" | "@cf/stabilityai/stable-diffusion-xl-base-1.0";

export const DEFAULT_IMAGE_MODEL: WorkersAiImageModel = "@cf/black-forest-labs/flux-1-schnell";

export type WorkersAiImageRequest = {
  prompt: string;
  /** Diffusion steps. Flux-schnell caps at 8; SDXL up to 20. Default 4. */
  numSteps?: number;
  /** Deterministic seed for reproducible images. Omit for random. */
  seed?: number;
  /** Pixel dimensions — flux-1-schnell supports up to 1024×1024. */
  width?: number;
  height?: number;
};

export class WorkersAiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`WorkersAI ${status}: ${body.slice(0, 200)}`);
    this.name = "WorkersAiError";
    this.status = status;
    this.body = body;
  }
}

export class WorkersAiConfigError extends Error {
  constructor(missing: string) {
    super(`Workers AI is not configured — missing ${missing}`);
    this.name = "WorkersAiConfigError";
  }
}

/**
 * Generate an image and return the raw bytes. Callers upload to R2.
 */
export async function generateImage(
  request: WorkersAiImageRequest,
  options?: { model?: WorkersAiImageModel; timeoutMs?: number },
): Promise<Uint8Array> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_WORKERS_AI_TOKEN;
  if (!accountId) throw new WorkersAiConfigError("CLOUDFLARE_ACCOUNT_ID");
  if (!token) throw new WorkersAiConfigError("CLOUDFLARE_WORKERS_AI_TOKEN");

  const model = options?.model ?? DEFAULT_IMAGE_MODEL;
  const timeoutMs = options?.timeoutMs ?? 60_000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${CF_API_BASE}/accounts/${accountId}/ai/run/${model}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        // Force binary response — the default is a base64-in-JSON envelope
        // for smaller images, which is a needless copy for our 1 MB PNGs.
        accept: "image/png",
      },
      body: JSON.stringify({
        prompt: request.prompt,
        num_steps: request.numSteps ?? 4,
        seed: request.seed,
        width: request.width,
        height: request.height,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new WorkersAiError(res.status, body);
    }

    // flux-1-schnell can return either raw PNG bytes OR a JSON wrapper with
    // base64 image data depending on the account/model combo — handle both.
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.startsWith("image/")) {
      const buf = await res.arrayBuffer();
      return new Uint8Array(buf);
    }
    if (contentType.includes("application/json")) {
      const json = (await res.json()) as { result?: { image?: string } };
      const b64 = json.result?.image;
      if (!b64) {
        throw new WorkersAiError(
          500,
          `unexpected JSON shape: ${JSON.stringify(json).slice(0, 200)}`,
        );
      }
      // Base64 decode without introducing a dep.
      return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    }
    throw new WorkersAiError(500, `unexpected content-type: ${contentType}`);
  } finally {
    clearTimeout(timeout);
  }
}
