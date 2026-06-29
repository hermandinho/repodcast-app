# Observability

Where Repodcast's events, errors, and traces land — and the contract every
new event has to satisfy.

## PostHog — product analytics

**Project key:** set `NEXT_PUBLIC_POSTHOG_KEY` (and optionally
`NEXT_PUBLIC_POSTHOG_HOST`, defaults to `https://us.i.posthog.com`). With
the key unset everything is a silent no-op — local dev without a PostHog
project just works.

### How to fire events

All events are type-safe via `lib/analytics/events.ts`. The compiler refuses
typos and payload drift at every call site. Two wrappers consume the same
`EventMap`:

| Call site                               | Wrapper                                                                                 | Notes                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Client component / browser              | `track(name, payload)` from `@/lib/analytics/track-client`                              | Defers to `posthog-js`, which the `<PostHogProvider>` initialises once on app load |
| Server action / Inngest / route handler | `trackServer(name, payload, { distinctId, agencyId? })` from `@/server/analytics/track` | POSTs to PostHog's `/capture/` endpoint with a 2-second timeout. Never throws      |

Backend events that aren't tied to a specific user use a stable
`distinctId` of `agency:${agencyId}` so PostHog can still de-duplicate
sessions. Pass `agencyId` separately and the wrapper also sets PostHog's
`$groups: { agency }` so dashboards can aggregate at the agency level.

### Active events

| Event                     | Fired from                                                                                 | Properties                                                                    | Why                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `onboarding_started`      | `OnboardingWizard` on mount (ref-gated for StrictMode)                                     | `suggestedAgencyName`                                                         | Top of the activation funnel — measures arrivals + rename rate                             |
| `agency_created`          | `OnboardingWizard` after `createAgencyAction` ok                                           | `agencyId`, `plan`                                                            | Step 2 of the activation funnel — measures workspace-setup completion + plan mix at signup |
| `first_client_added`      | `createClientAction` after the create when the agency had zero prior clients               | `agencyId`, `clientId`                                                        | Step 3 of the activation funnel — fires exactly once per agency, not per create            |
| `first_episode_generated` | `generate-episode.ts` after mark-ready when the agency just landed its first READY episode | `agencyId`, `episodeId`                                                       | Step 4 of the activation funnel — first time-to-value milestone                            |
| `generation_completed`    | `inngest/functions/generate-episode.ts` after persist-outputs                              | `episodeId`, `platform` (Prisma enum), `outputTokens`, `durationMs`           | Time-to-value of the activation flow + latency distribution per platform                   |
| `output_approved`         | `OutputsView` on approve action success                                                    | `outputId`, `platform` (UI key), `edited` (bool), `editDistance`              | Drives the "% posted with no edits" hero KPI on the dashboard                              |
| `output_edited`           | `OutputsView` on edit action success                                                       | `outputId`, `platform`, `delta` (this save), `totalEditDistance` (cumulative) | Cumulative edit volume per output — investigates which platforms need the most rewriting   |

Adding a new event = extend `EventMap` + fire from the appropriate
wrapper. The compiler enforces the rest.

### Funnel notes

`first_client_added` and `first_episode_generated` are **gated server-side**
(count check before fire) so they land exactly once per agency. That means
PostHog funnel queries don't need their own dedupe pass — the events
themselves are the milestones. The gates are:

- `first_client_added`: `prisma.client.count` is queried before the create;
  fires only when the prior count was 0. Concurrent creates lose the race
  (post-create count of 2+ gates the loser out).
- `first_episode_generated`: combined with the `mark-ready` step in the
  Inngest function — counts agency-wide READY episodes immediately after the
  status flip; fires only when the count is 1. `step.run` memoization makes
  the check + fire idempotent across Inngest retries.

### Dashboards

> TODO: link the PostHog dashboards once they're stood up. The activation
> funnel (`onboarding_started → agency_created → first_client_added →
first_episode_generated`) is the priority view — drop-off on any step
> identifies where signups stall before time-to-value.

## Health probe

`GET /api/health` returns structured JSON for uptime monitors. Public (in
the middleware matcher), `force-dynamic`, Node runtime.

```json
{
  "status": "ok",
  "checks": {
    "db": { "status": "ok", "latencyMs": 12 },
    "clerk": { "status": "ok" },
    "inngest": { "status": "ok" }
  },
  "timestamp": "2026-06-29T01:42:00.000Z"
}
```

- **`db`** runs a `SELECT 1` round-trip. The only check that can flip the
  overall status to `degraded` and the HTTP code to `503` — nothing in the
  app works without the database.
- **`clerk`** + **`inngest`** are config-presence checks. A missing key
  downgrades the entry to `not_configured`, not a failure — local dev
  without those keys is supported and we don't want to page anyone for it.

Point Vercel's monitoring + any external uptime tool at this endpoint;
non-200 responses mean "intervene now."

## Sentry — error capture

`@sentry/nextjs` is wired in `sentry.{client,server,edge}.config.ts` plus
`instrumentation.ts` (dispatches per runtime). All three are no-ops without
a DSN — set `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` (same value). Source-map
upload only happens at build time when `SENTRY_AUTH_TOKEN` is set, typically
in CI.

The `next.config.ts` only wraps the config with `withSentryConfig` when
`SENTRY_DSN` is set — keeps build logs clean for local dev.
