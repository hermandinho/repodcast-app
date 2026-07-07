"use client";

import { Analytics } from "@vercel/analytics/next";

/**
 * Vercel Web Analytics with a `beforeSend` filter that drops every event
 * originating under `/root/*`. Root is our internal platform-admin surface
 * — operator activity there isn't product usage and would just skew the
 * pageview/action mix in the Vercel dashboard.
 *
 * Filter runs client-side before the request is issued, so no data leaves
 * the browser for suppressed events (no network waste, no lookalike concern
 * from the operator's IP being sampled).
 *
 * Client-only because `beforeSend` is a function prop and the surrounding
 * `<Analytics />` component is itself a client component.
 */
export function AnalyticsWithFilter() {
  return (
    <Analytics
      beforeSend={(event) => {
        try {
          const { pathname } = new URL(event.url);
          if (pathname === "/root" || pathname.startsWith("/root/")) return null;
        } catch {
          // Malformed URL — let Vercel keep its own decision; dropping
          // silently would hide bugs.
        }
        return event;
      }}
    />
  );
}
