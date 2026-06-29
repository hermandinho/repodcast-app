"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import posthog from "posthog-js";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

/**
 * Initialise PostHog once on the client. Skipped silently when
 * `NEXT_PUBLIC_POSTHOG_KEY` isn't set, so local dev without a PostHog project
 * is a no-op.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!KEY || posthog.__loaded) return;
    posthog.init(KEY, {
      api_host: HOST,
      // We capture pageviews manually in PostHogPageviews so we can include
      // App Router navigations.
      capture_pageview: false,
      person_profiles: "identified_only",
    });
    posthog.capture("app_loaded", { source: "web" });
  }, []);

  return (
    <>
      {children}
      {/* useSearchParams must live inside a Suspense boundary to keep the
          root layout server-rendered. */}
      <Suspense fallback={null}>
        <PostHogPageviews />
      </Suspense>
    </>
  );
}

function PostHogPageviews() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!KEY || !posthog.__loaded) return;
    const search = searchParams?.toString();
    const url = search ? `${pathname}?${search}` : pathname;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}
