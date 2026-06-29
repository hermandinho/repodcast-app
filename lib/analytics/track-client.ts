"use client";

import posthog from "posthog-js";
import type { EventName, EventPayload } from "./events";

/**
 * Client-side PostHog capture. Silent no-op when the SDK hasn't loaded —
 * which happens on every page load if `NEXT_PUBLIC_POSTHOG_KEY` is unset
 * (the provider skips `init()` then), so this helper is safe to call
 * unconditionally from any client component.
 *
 * Why a wrapper: typing. `posthog.capture(name, props)` accepts any string
 * + any record, so every call site is a potential drift risk. Going through
 * `track(event, payload)` keyed off `EventMap` makes typos a compile error.
 */
export function track<E extends EventName>(event: E, payload: EventPayload<E>): void {
  if (!posthog.__loaded) return;
  posthog.capture(event, payload);
}
