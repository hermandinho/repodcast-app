import Fastify from "fastify";
import { z } from "zod";
import { renderAudiogram } from "./jobs/audiogram.js";
import { renderClip } from "./jobs/clip.js";
import { jobAudio, jobCaptions, jobMetadata } from "./jobs/youtube.js";
import { YouTubeImportError } from "./lib/youtube.js";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";
const SHARED_SECRET = process.env.WORKER_SHARED_SECRET;
const ENV_NAME = process.env.WORKER_ENV ?? "unknown";

if (!SHARED_SECRET) {
  console.error("FATAL: WORKER_SHARED_SECRET is not set");
  process.exit(1);
}

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
  },
  trustProxy: true,
});

// Every render endpoint checks Bearer auth against WORKER_SHARED_SECRET.
// /healthz is deliberately unauthenticated so Cloudflare Tunnel and any
// external uptime monitor can hit it without a secret.
app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/healthz") return;
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return reply.code(401).send({ error: "missing bearer token" });
  }
  const provided = header.slice("Bearer ".length);
  if (provided !== SHARED_SECRET) {
    return reply.code(401).send({ error: "invalid bearer token" });
  }
});

app.get("/healthz", async () => ({
  ok: true,
  env: ENV_NAME,
  uptime: process.uptime(),
  version: process.env.IMAGE_TAG ?? "local",
}));

// Clip render. Full pipeline in ./jobs/clip.ts.
const clipRequestSchema = z.object({
  clipId: z.string().min(1).max(200),
  sourceUrl: z.string().url(),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(1),
  captionsSrt: z.string(),
  aspect: z.enum(["9:16", "1:1", "16:9"]),
  // Reject `..` and absolute paths — outputPrefix becomes an R2 key prefix.
  outputPrefix: z
    .string()
    .min(1)
    .max(500)
    .refine((s) => !s.includes(".."), "outputPrefix must not contain '..'")
    .refine((s) => !s.startsWith("/"), "outputPrefix must not start with '/'"),
});

app.post("/render/clip", async (req, reply) => {
  const parsed = clipRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid request", details: parsed.error.flatten() });
  }
  const input = parsed.data;
  if (input.endMs <= input.startMs) {
    return reply.code(400).send({ error: "endMs must be greater than startMs" });
  }
  try {
    const result = await renderClip(input);
    return result;
  } catch (err) {
    req.log.error({ err, clipId: input.clipId }, "render/clip failed");
    return reply.code(500).send({
      error: err instanceof Error ? err.message : String(err),
      clipId: input.clipId,
    });
  }
});

// Q1 feature #5 — audiogram render. Full pipeline in ./jobs/audiogram.ts.
const audiogramRequestSchema = z.object({
  outputId: z.string().min(1).max(200),
  audioUrl: z.string().url(),
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(1),
  captionsSrt: z.string(),
  aspect: z.enum(["1:1", "9:16"]),
  backgroundImageUrl: z.string().url().nullable(),
  outputPrefix: z
    .string()
    .min(1)
    .max(500)
    .refine((s) => !s.includes(".."), "outputPrefix must not contain '..'")
    .refine((s) => !s.startsWith("/"), "outputPrefix must not start with '/'"),
});

app.post("/render/audiogram", async (req, reply) => {
  const parsed = audiogramRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid request", details: parsed.error.flatten() });
  }
  const input = parsed.data;
  if (input.endMs <= input.startMs) {
    return reply.code(400).send({ error: "endMs must be greater than startMs" });
  }
  try {
    const result = await renderAudiogram(input);
    return result;
  } catch (err) {
    req.log.error({ err, outputId: input.outputId }, "render/audiogram failed");
    return reply.code(500).send({
      error: err instanceof Error ? err.message : String(err),
      outputId: input.outputId,
    });
  }
});

// ---------------------------------------------------------------------------
// YouTube import — three endpoints mirror the app's adapter fns
// (server/imports/youtube.ts). Running yt-dlp from the worker rather than
// Vercel dodges YouTube's datacenter-IP anti-bot check.
//
// On `YouTubeImportError` we return 400 with `{ error: { code, message,
// stderr } }` so the app-side HTTP client can re-throw the same class
// with the same code, keeping the Inngest fn's terminal/retryable
// classifier unchanged.
// ---------------------------------------------------------------------------

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function sendYouTubeError(reply: import("fastify").FastifyReply, err: unknown) {
  if (err instanceof YouTubeImportError) {
    return reply.code(400).send({
      error: { code: err.code, message: err.message, stderr: err.stderr },
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return reply.code(500).send({ error: { code: "fetch_failed", message } });
}

const metadataRequestSchema = z.object({
  videoId: z.string().regex(VIDEO_ID_RE, "videoId must be an 11-char YouTube id"),
});

app.post("/import/youtube/metadata", async (req, reply) => {
  const parsed = metadataRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid request", details: parsed.error.flatten() });
  }
  try {
    return await jobMetadata(parsed.data.videoId);
  } catch (err) {
    req.log.warn({ err, videoId: parsed.data.videoId }, "import/youtube/metadata failed");
    return sendYouTubeError(reply, err);
  }
});

const captionsRequestSchema = z.object({
  videoId: z.string().regex(VIDEO_ID_RE),
  track: z.object({
    languageCode: z.string().min(1).max(40),
    name: z.string().max(200),
    isGenerated: z.boolean(),
  }),
});

app.post("/import/youtube/captions", async (req, reply) => {
  const parsed = captionsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid request", details: parsed.error.flatten() });
  }
  try {
    return await jobCaptions(parsed.data);
  } catch (err) {
    req.log.warn({ err, videoId: parsed.data.videoId }, "import/youtube/captions failed");
    return sendYouTubeError(reply, err);
  }
});

const audioRequestSchema = z.object({
  videoId: z.string().regex(VIDEO_ID_RE),
  // Reject `..` and absolute paths — keyPrefix becomes an R2 key prefix, same
  // discipline as the render endpoints' `outputPrefix`.
  keyPrefix: z
    .string()
    .min(1)
    .max(500)
    .refine((s) => !s.includes(".."), "keyPrefix must not contain '..'")
    .refine((s) => !s.startsWith("/"), "keyPrefix must not start with '/'"),
  maxBytes: z
    .number()
    .int()
    .min(1024 * 1024)
    .max(2 * 1024 * 1024 * 1024),
});

app.post("/import/youtube/audio", async (req, reply) => {
  const parsed = audioRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid request", details: parsed.error.flatten() });
  }
  try {
    return await jobAudio(parsed.data);
  } catch (err) {
    req.log.warn({ err, videoId: parsed.data.videoId }, "import/youtube/audio failed");
    return sendYouTubeError(reply, err);
  }
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info({ port: PORT, env: ENV_NAME }, "worker ready");
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
