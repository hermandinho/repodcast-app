import Fastify from "fastify";
import { z } from "zod";
import { renderAudiogram } from "./jobs/audiogram.js";
import { renderClip } from "./jobs/clip.js";

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
