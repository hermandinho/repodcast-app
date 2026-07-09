"use client";

import { useEffect } from "react";

/**
 * Fire-and-forget view beacon for `/blog/[slug]`. Mounted inside the RSC page
 * so it inherits SSR positioning without hydration weirdness.
 *
 * Dedup: `sessionStorage` per slug per tab. A reader that reloads the page
 * or bounces back from a related-post link is one view, not many. Cross-tab
 * still counts (those are separate reading sessions — usually).
 *
 * Transport: prefers `navigator.sendBeacon` (survives tab-close, doesn't
 * block navigation). Falls back to `fetch` with `keepalive` for the rare
 * browser that lacks sendBeacon (Safari on very old iOS). We never `await`;
 * a failed beacon is a lost view, not a broken page.
 *
 * Bot exclusion happens server-side (`/api/blog/[slug]/view` regex-checks
 * `User-Agent`). We don't try to detect bots client-side because they
 * mostly don't run JS anyway.
 */

const STORAGE_PREFIX = "blogview:";

export function BlogViewBeacon({ slug }: { slug: string }): null {
  useEffect(() => {
    // Guard: no window (shouldn't fire in RSC, but the effect body is
    // browser-only by design).
    if (typeof window === "undefined") return;

    const key = `${STORAGE_PREFIX}${slug}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // sessionStorage can throw in private mode / storage-blocked browsers.
      // Fall through — we'd rather over-count than lose the view entirely.
    }

    const url = `/api/blog/${encodeURIComponent(slug)}/view`;
    try {
      if (typeof navigator.sendBeacon === "function") {
        // Empty Blob keeps the request lean; the route reads no body.
        navigator.sendBeacon(url, new Blob([], { type: "text/plain" }));
        return;
      }
    } catch {
      // sendBeacon has been observed to throw on some strict CSPs — fall
      // through to fetch.
    }

    // Fallback path: keepalive lets the request survive the tab closing.
    void fetch(url, { method: "POST", keepalive: true }).catch(() => {
      // Silent — we're not going to Sentry a lost view.
    });
  }, [slug]);

  return null;
}
