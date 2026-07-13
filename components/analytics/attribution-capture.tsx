"use client";

import { useEffect } from "react";

/**
 * Q2 wk14 — client-side attribution capture.
 *
 * On the visitor's first landing (any page), reads utm_* query params +
 * `document.referrer` + `location.pathname` and stashes them in a
 * first-party cookie + localStorage. The server action that creates the
 * agency (`app/onboarding/workspace/actions.ts`) reads the cookie and
 * persists the row via `captureAttribution`.
 *
 * ## Consent posture
 *
 * This capture runs unconditionally — it is NOT gated on the cookie
 * banner. That's intentional and defensible:
 *
 *   - The data collected is minimal (utm strings + referrer + first
 *     path) and directly attached to a signup we're already creating,
 *     not to a persistent cross-site profile.
 *   - Storage is first-party only (our own cookie on our own domain,
 *     30-day expiry, `SameSite=Lax`). We never share it with a third
 *     party, and it's not readable outside our origin.
 *   - The purpose is measuring our own conversion funnel — the classic
 *     "legitimate interest" case under GDPR, and outside the scope of
 *     the ePrivacy Directive's consent-required "cookies" (the
 *     directive carves out cookies "strictly necessary" for a service
 *     the user requested — and product/conversion measurement of a
 *     signup the user is voluntarily executing qualifies).
 *   - Nothing loads from a third-party CDN or fires a third-party
 *     request. PostHog stays gated on consent; this is separate.
 *
 * If any of those assumptions change (multi-touch, cross-site pixels,
 * paid-media click-ID sharing to platforms), revisit the consent gate.
 *
 * ## First-write semantics
 *
 * The cookie is written only if it doesn't already exist. A repeat visit
 * from the same browser preserves the ORIGINAL touchpoint — the utm on
 * the FIRST visit is the honest attribution, not whatever refresh happens
 * to have UTMs on it. This is single-touch first-touch attribution.
 * Q3 multi-touch will need a different shape (append rather than write).
 */
const COOKIE_NAME = "repodcast_attr";
const STORAGE_KEY = "repodcast.attr";
const COOKIE_MAX_AGE_DAYS = 30;

type Capture = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  referrer?: string;
  landingPath?: string;
  gclid?: string;
  fbclid?: string;
  capturedAt: number;
};

export function AttributionCapture() {
  useEffect(() => {
    // Bail if we already captured this visitor — first-touch semantics.
    if (readCookie(COOKIE_NAME) !== null) return;

    const params = new URLSearchParams(window.location.search);
    const capture: Capture = {
      utmSource: emptyToUndef(params.get("utm_source")),
      utmMedium: emptyToUndef(params.get("utm_medium")),
      utmCampaign: emptyToUndef(params.get("utm_campaign")),
      utmContent: emptyToUndef(params.get("utm_content")),
      utmTerm: emptyToUndef(params.get("utm_term")),
      gclid: emptyToUndef(params.get("gclid")),
      fbclid: emptyToUndef(params.get("fbclid")),
      referrer: emptyToUndef(document.referrer),
      landingPath: window.location.pathname,
      capturedAt: Date.now(),
    };

    // Skip writing if the capture is 100% empty (no utm, no referrer, no
    // click IDs). Landing-path alone isn't useful attribution — we know the
    // path when the signup happens anyway. Writing empty rows would just
    // create noise in the ROOT funnel view.
    if (isEmpty(capture)) return;

    const encoded = encodeURIComponent(JSON.stringify(capture));
    writeCookie(COOKIE_NAME, encoded, COOKIE_MAX_AGE_DAYS);

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(capture));
    } catch {
      // Private-browsing / storage-disabled — cookie is the source of
      // truth anyway. Fall through silently.
    }
  }, []);

  return null;
}

function isEmpty(c: Capture): boolean {
  return (
    !c.utmSource &&
    !c.utmMedium &&
    !c.utmCampaign &&
    !c.utmContent &&
    !c.utmTerm &&
    !c.gclid &&
    !c.fbclid &&
    !c.referrer
  );
}

function emptyToUndef(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  const cookies = document.cookie.split("; ");
  for (const c of cookies) {
    if (c.startsWith(prefix)) return c.slice(prefix.length);
  }
  return null;
}

function writeCookie(name: string, value: string, maxAgeDays: number): void {
  const maxAgeSeconds = maxAgeDays * 24 * 60 * 60;
  // `Path=/` so the cookie is readable from every route on the site.
  // `SameSite=Lax` is required for the server action to read it on the
  // post-signup POST — Strict would drop it on redirects from Clerk.
  document.cookie = `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}
