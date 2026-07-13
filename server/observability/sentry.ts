import "server-only";

import * as Sentry from "@sentry/nextjs";

/**
 * Phase 3.7 — Sentry capture helpers for pipeline + webhook failures.
 *
 * Two entry points:
 *   - `captureInngestFailure(scope, err, extra?)` — called from an
 *     Inngest function's `onFailure` handler (i.e. after retries have
 *     been exhausted). Tags the event with `scope` so operators can
 *     alert per-pipeline (`generation_pipeline`, `rss_import`, etc.)
 *     and includes the event id / attempt count / message from Inngest's
 *     runtime metadata as `extra`.
 *   - `captureWebhookFailure(scope, err, extra?)` — same shape but for
 *     inbound webhook routes (Stripe / Clerk / Resend) that can't rely
 *     on Inngest's retry model. The route re-throws after this so the
 *     provider retries the delivery.
 *
 * Both no-op silently when `SENTRY_DSN` (server) or
 * `NEXT_PUBLIC_SENTRY_DSN` (client fallback) is unset — same fail-open
 * posture as the other telemetry helpers so a bootstrap-less dev
 * environment doesn't spew noise.
 *
 * We don't dedupe the same error across retries because Sentry already
 * groups by fingerprint; multiple captures of the same throw show up as
 * a single issue with a bumped event count. Firing from `onFailure`
 * (post-retries) is what gives us signal — not per-attempt captures.
 */

export type PipelineScope =
  | "generation_pipeline"
  | "regenerate_output"
  | "rss_import"
  | "youtube_import"
  | "transcribe"
  | "voice_refresh"
  | "usage_rollup"
  | "renewals_cron"
  | "onboarding_nudges"
  | "cleanup_orphan_audio"
  | "scheduling_sync"
  | "generate_clips"
  | "generate_audiogram"
  | "generate_artwork";

export type WebhookScope = "stripe_webhook" | "clerk_webhook" | "resend_webhook";

function sentryEnabled(): boolean {
  return Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);
}

/**
 * Capture an Inngest function failure after retries have been exhausted.
 * Call from `onFailure` — never from inside the fn body itself, or every
 * retry attempt spams Sentry.
 */
export function captureInngestFailure(
  scope: PipelineScope,
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  if (!sentryEnabled()) return;
  Sentry.withScope((s) => {
    s.setTag("layer", "inngest");
    s.setTag("scope", scope);
    if (extra) s.setContext("failure", extra);
    // Handle both Error and thrown-non-Error values — Inngest's onFailure
    // sometimes surfaces the latter for NonRetriableError wrappers.
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
  });
}

/**
 * Capture a webhook route failure. The route re-throws after this so the
 * provider retries; we tag `layer: webhook` so operators can alert on
 * this bucket separately from Inngest failures.
 */
export function captureWebhookFailure(
  scope: WebhookScope,
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  if (!sentryEnabled()) return;
  Sentry.withScope((s) => {
    s.setTag("layer", "webhook");
    s.setTag("scope", scope);
    if (extra) s.setContext("failure", extra);
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
  });
}
