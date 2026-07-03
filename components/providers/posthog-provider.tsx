"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useSyncExternalStore } from "react";
import posthog from "posthog-js";
import { readConsent, subscribeConsent, type ConsentValue } from "@/lib/consent";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

/**
 * Initialise PostHog once on the client — but only after the visitor has
 * granted consent via the cookie banner. Skipped silently when
 * `NEXT_PUBLIC_POSTHOG_KEY` isn't set, so local dev without a PostHog project
 * is a no-op.
 *
 * GDPR posture: SDK stays off entirely until `readConsent() === "accepted"`.
 * If the visitor declines, opts out later (via cookie preferences), or
 * hasn't chosen yet, no PostHog code loads and no cookies are written. Consent
 * flows in through `useSyncExternalStore` so an "Accept" click wakes the
 * SDK up mid-session without a page reload — and no `setState`-in-`useEffect`
 * hydration shuffle.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const consent = useSyncExternalStore(subscribeConsent, readConsent, () => null);

  useEffect(() => {
    if (!KEY) return;
    if (consent !== "accepted") return;
    if (posthog.__loaded) return;
    posthog.init(KEY, {
      api_host: HOST,
      // We capture pageviews manually in PostHogPageviews so we can include
      // App Router navigations.
      capture_pageview: false,
      person_profiles: "identified_only",
    });
    posthog.capture("app_loaded", { source: "web" });
  }, [consent]);

  return (
    <>
      {children}
      {/* useSearchParams must live inside a Suspense boundary to keep the
          root layout server-rendered. */}
      <Suspense fallback={null}>
        <PostHogPageviews consent={consent} />
      </Suspense>
    </>
  );
}

function PostHogPageviews({ consent }: { consent: ConsentValue | null }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!KEY || consent !== "accepted" || !posthog.__loaded) return;
    const search = searchParams?.toString();
    const url = search ? `${pathname}?${search}` : pathname;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams, consent]);

  return null;
}
