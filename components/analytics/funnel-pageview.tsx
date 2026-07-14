"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/analytics/track-client";

/**
 * Targeted funnel-step pageview event.
 *
 * PostHog's autocaptured `$pageview` fires on every route change; that's
 * too noisy for building the acquisition funnel. This one-shot tracker
 * fires ONE named funnel event per component mount so PostHog's funnel
 * builder can key off distinct step events without wading through the
 * pageview stream.
 *
 * Silent no-op when consent hasn't been granted (delegated to the
 * `track` wrapper, which is gated on `posthog.__loaded`).
 *
 * Usage:
 *   <FunnelPageview event="landing_hero_viewed" />
 *
 * Only wire this on pages that represent actual funnel steps. Do NOT
 * scatter it on every route.
 */
export function FunnelPageview({
  event,
}: {
  event: "landing_hero_viewed" | "pricing_viewed" | "signup_started";
}) {
  const pathname = usePathname();
  useEffect(() => {
    track(event, { funnelPath: pathname ?? "/" });
  }, [event, pathname]);
  return null;
}
