"use client";

import posthog from "posthog-js";
import { useEffect, useState } from "react";

/**
 * Phase 3.7 — client-side feature-flag hook.
 *
 * Thin wrapper around `posthog-js`'s flag API so the app has a single
 * `useFeatureFlag("<key>")` entry point instead of a dozen call sites
 * touching the SDK directly. Returns a boolean; multivariate flags land
 * as a follow-up.
 *
 * Semantics:
 *   - Returns `false` while the SDK is initialising OR when
 *     `NEXT_PUBLIC_POSTHOG_KEY` is unset (dev fail-open). Callers should
 *     assume "feature off" is the safe default state.
 *   - Re-reads via `onFeatureFlags` so a background refresh from the
 *     `/decide` endpoint (or a manual override in the PostHog toolbar)
 *     rerenders the caller.
 *   - Server-side, use `getServerFeatureFlag` for RSC / route handlers
 *     (below).
 */
export function useFeatureFlag(key: string): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => {
    // Read synchronously if the SDK is already ready — avoids a first-
    // render flash of "off → on" when the value is cached.
    if (typeof window === "undefined") return false;
    const v = posthog.isFeatureEnabled?.(key);
    return v === true;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Initial check on mount — the SDK may be ready by now even if it
    // wasn't during the initial render. Disable the react-hooks rule
    // here: this is a legitimate "sync external state on mount" pattern
    // documented in the PostHog SDK docs, not a state-in-effect anti-
    // pattern.
    const initial = posthog.isFeatureEnabled?.(key);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external-source sync
    if (initial === true) setEnabled(true);

    // Subscribe to updates. PostHog fires this on every flag refresh
    // (initial load, periodic refresh, `posthog.reloadFeatureFlags()`).
    const unsubscribe = posthog.onFeatureFlags?.((flags) => {
      const nextVal = flags.includes(key);
      setEnabled(nextVal);
    });
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [key]);

  return enabled;
}
