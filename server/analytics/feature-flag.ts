import "server-only";

/**
 * Phase 3.7 — server-side feature flag lookup.
 *
 * Reads PostHog's `/decide` endpoint for a given `distinctId`. Fails
 * open (returns `false`) on network / auth / missing-env errors — same
 * posture as `trackServer` in this package. Never throws.
 *
 * Use from RSC pages + server actions where you need to gate a code
 * path server-side (e.g. don't render an expensive SSR section for
 * unbucketed users). For client components use `useFeatureFlag` in
 * `lib/analytics/feature-flag.ts` instead.
 *
 * Not cached — every call is a fresh POST. If the same page fetches
 * multiple flags, wrap in a `Promise.all` on the caller side; a
 * per-request cache is a follow-up if this shows up on latency traces.
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
const DECIDE_TIMEOUT_MS = 2_000;

export async function getServerFeatureFlag(
  distinctId: string,
  key: string,
  groups?: { agencyId?: string },
): Promise<boolean> {
  if (!KEY) return false;
  try {
    const res = await fetch(`${HOST.replace(/\/$/, "")}/decide?v=3`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: KEY,
        distinct_id: distinctId,
        ...(groups?.agencyId ? { groups: { agency: groups.agencyId } } : {}),
      }),
      signal: AbortSignal.timeout(DECIDE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[posthog] /decide returned ${res.status} for flag=${key}`);
      return false;
    }
    const data = (await res.json()) as {
      featureFlags?: Record<string, boolean | string>;
    };
    const raw = data.featureFlags?.[key];
    // PostHog returns booleans for boolean flags and variant-name strings
    // for multivariate. We treat any non-`false` variant as "on" for
    // this shim — callers needing variant strings can add a variant
    // helper later.
    return raw === true || (typeof raw === "string" && raw !== "false" && raw !== "");
  } catch (err) {
    console.warn(`[posthog] /decide failed for flag=${key}`, err);
    return false;
  }
}
