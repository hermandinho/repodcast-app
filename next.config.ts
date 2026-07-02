import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["charming-creative-sunbird.ngrok-free.app"],
  // Phase 3.2 — force-include the yt-dlp binary in the Inngest route's
  // bundle on Vercel. Next's file tracer picks up require()'d modules but
  // not spawn'd binary paths; without this, the Vercel deployment would
  // ship without the binary and every YouTube import would ENOENT.
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
