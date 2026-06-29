// Next 16 instrumentation hook — dispatched once per server runtime.
// Sentry's Node + Edge configs are imported here so they only load in their
// respective environments. The actual `Sentry.init` calls are no-ops when
// SENTRY_DSN isn't set, so this hook is safe to leave wired in any env.

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export { captureRequestError as onRequestError } from "@sentry/nextjs";
