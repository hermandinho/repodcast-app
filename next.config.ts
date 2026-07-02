import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["charming-creative-sunbird.ngrok-free.app"],
  // Phase 3.2 — yt-dlp integration.
  //
  // 1. `serverExternalPackages` — don't bundle yt-dlp-exec into the
  //    server build. When bundled by Turbopack, the package's
  //    `path.join(__dirname, '..', 'bin')` computes against Turbopack's
  //    virtual filesystem (paths that look like `\ROOT\node_modules\...`)
  //    which don't exist at runtime → ENOENT on every spawn. Marking it
  //    external tells Next to require it from real node_modules at
  //    runtime, so `__dirname` resolves to the actual on-disk directory.
  //
  // 2. `outputFileTracingIncludes` — force the yt-dlp binary into the
  //    Vercel deployment's `/api/inngest` bundle. Next's file tracer
  //    picks up require()'d modules but not spawn'd binary paths; without
  //    this the deploy would ship without the binary.
  serverExternalPackages: ["yt-dlp-exec"],
  outputFileTracingIncludes: {
    "/api/inngest": ["./node_modules/yt-dlp-exec/bin/**"],
  },
};

// Only wrap with Sentry if a DSN is configured — otherwise the plugin warns
// about missing source-map upload credentials on every build.
const config: NextConfig = process.env.SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: !process.env.CI,
      // Suppress source-map upload + telemetry when no auth token is present
      // (e.g. local builds).
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disableLogger: true,
    })
  : nextConfig;

export default config;
