import Fastify from "fastify";

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

// Placeholder endpoints — real implementations land with clip generation (Q1 wk3).
app.post("/render/clip", async (_req, reply) => {
  return reply.code(501).send({ error: "not implemented yet" });
});

app.post("/render/audiogram", async (_req, reply) => {
  return reply.code(501).send({ error: "not implemented yet" });
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
