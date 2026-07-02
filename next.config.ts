import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["charming-creative-sunbird.ngrok-free.app"],
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
