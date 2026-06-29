import "server-only";

import type { EventName, EventPayload } from "@/lib/analytics/events";

/**
 * Server-side PostHog capture via PostHog's plain `/capture/` HTTP endpoint.
 * Skipped silently when `NEXT_PUBLIC_POSTHOG_KEY` is unset and never throws —
 * telemetry must not block the caller's work (Inngest persists, server
 * actions, etc.). Same `EventMap`-typed API as `track-client.ts` so the
 * compiler still catches typos.
 *
 * Why no `posthog-node` dep: the capture endpoint is one POST. The node SDK's
 * batching/shutdown semantics buy us nothing for our handful of events per
 * pipeline run and add a dependency + a shutdown hook risk in serverless.
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

export type ServerTrackOptions = {
  /** Stable distinct id — use `agency:${agencyId}` for backend-only events. */
  distinctId: string;
  /** Optional PostHog group key so dashboards can aggregate by agency. */
  agencyId?: string;
};

export async function trackServer<E extends EventName>(
  event: E,
  payload: EventPayload<E>,
  opts: ServerTrackOptions,
): Promise<void> {
  if (!KEY) return;
  const body = {
    api_key: KEY,
    event,
    distinct_id: opts.distinctId,
    properties: {
      ...payload,
      ...(opts.agencyId ? { $groups: { agency: opts.agencyId }, agencyId: opts.agencyId } : {}),
    },
    timestamp: new Date().toISOString(),
  };
  try {
    const res = await fetch(`${HOST.replace(/\/$/, "")}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Telemetry can't extend the user's wait — bound it tightly.
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      console.warn(`[posthog] capture ${event} returned ${res.status}`);
    }
  } catch (err) {
    console.warn(`[posthog] capture ${event} failed`, err);
  }
}
