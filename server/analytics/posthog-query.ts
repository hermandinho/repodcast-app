import "server-only";

/**
 * Q2 wk14 — server-side PostHog HogQL query client.
 *
 * The client-side `posthog.capture` pushes events INTO PostHog; this helper
 * pulls counts BACK OUT via PostHog's HogQL query endpoint so the ROOT
 * `/root/funnels` page can render our own mirror of the funnel without
 * depending on the PostHog UI or a scheduled ETL.
 *
 * ## Auth
 *
 * Uses a **Personal API Key** (not the public project key). Set
 * `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` in env; both are
 * required for queries to fire. Missing either → helper returns `null`
 * and callers fall back to a "PostHog not configured" placeholder.
 *
 * Endpoint reference:
 *   https://posthog.com/docs/api/query
 *
 * ## Cost
 *
 * HogQL queries count against PostHog's per-project rate limit. Keep to
 * a handful of queries per page render. If a downstream page needs
 * many, batch via `queryAll` (parallel) or add memoization —
 * `unstable_cache` with a short TTL is fine, funnel numbers don't need
 * to be sub-second-fresh.
 */

const HOST = (process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com").replace(
  /\/$/,
  "",
);
const PERSONAL_KEY = process.env.POSTHOG_PERSONAL_API_KEY;
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID;

export function isPostHogConfigured(): boolean {
  return Boolean(PERSONAL_KEY && PROJECT_ID);
}

/**
 * Run one HogQL query. Returns rows (`Array<Array<unknown>>`) matching the
 * `SELECT`'s column order, or `null` when PostHog isn't configured / the
 * query errored. Never throws — the funnel page renders a partial view
 * rather than 500ing on a PostHog outage.
 */
export async function runHogQL(query: string): Promise<Array<Array<unknown>> | null> {
  if (!isPostHogConfigured()) return null;
  try {
    const res = await fetch(`${HOST}/api/projects/${PROJECT_ID}/query/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PERSONAL_KEY}`,
      },
      body: JSON.stringify({
        query: { kind: "HogQLQuery", query },
      }),
      // Bound the wait — the ROOT page render must not stall if PostHog is
      // slow. 5s is generous for an aggregate over <1M events.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn(`[posthog-query] ${res.status} ${res.statusText}`);
      return null;
    }
    const body: { results?: Array<Array<unknown>> } = await res.json();
    return body.results ?? [];
  } catch (err) {
    console.warn("[posthog-query] failed", err);
    return null;
  }
}

/**
 * Count occurrences of one event over a time window. Returns 0 when the
 * event has never fired, `null` when PostHog isn't configured.
 */
export async function countEvent(eventName: string, from: Date, to: Date): Promise<number | null> {
  const rows = await runHogQL(
    `SELECT count() FROM events
     WHERE event = '${sanitizeIdent(eventName)}'
       AND timestamp >= toDateTime('${from.toISOString()}')
       AND timestamp < toDateTime('${to.toISOString()}')`,
  );
  if (rows === null) return null;
  const cell = rows[0]?.[0];
  return typeof cell === "number" ? cell : Number(cell ?? 0);
}

/**
 * Distinct-persons count for one event over a time window. Returns 0 /
 * `null` on the same conventions as `countEvent`.
 */
export async function countDistinctPersons(
  eventName: string,
  from: Date,
  to: Date,
): Promise<number | null> {
  const rows = await runHogQL(
    `SELECT count(DISTINCT person_id) FROM events
     WHERE event = '${sanitizeIdent(eventName)}'
       AND timestamp >= toDateTime('${from.toISOString()}')
       AND timestamp < toDateTime('${to.toISOString()}')`,
  );
  if (rows === null) return null;
  const cell = rows[0]?.[0];
  return typeof cell === "number" ? cell : Number(cell ?? 0);
}

/**
 * Guardrail — HogQL identifiers should never contain quotes or backslashes.
 * All our event names are lowercase-underscore literals from `EventMap`, so
 * this is defense-in-depth. Reject anything unexpected before it hits the
 * fetch.
 */
function sanitizeIdent(value: string): string {
  if (!/^[a-zA-Z0-9_.$]+$/.test(value)) {
    throw new Error(`Refusing to interpolate untrusted identifier: ${value}`);
  }
  return value;
}
