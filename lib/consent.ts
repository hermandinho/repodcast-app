"use client";

/**
 * Cookie-and-analytics consent state — the visitor's decision on whether we
 * may load PostHog + set the trackers it depends on. Persisted in
 * `localStorage` so it survives page reloads and cross-tab within the same
 * origin. Not a server-readable cookie: the only consumers are client-side
 * (PostHog provider + the banner itself), so a cookie would just enlarge
 * every request header for no benefit.
 *
 * Values:
 * - `"accepted"` — PostHog may init + capture pageviews / product events.
 * - `"declined"` — PostHog stays out of the page entirely.
 * - `null`      — no decision yet; the banner renders.
 */

const STORAGE_KEY = "repodcast_consent";
const CHANGE_EVENT = "repodcast:consent-change";

export type ConsentValue = "accepted" | "declined";

/** SSR-safe read. Returns `null` on the server (no `window`) or when unset. */
export function readConsent(): ConsentValue | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "accepted" || raw === "declined") return raw;
    return null;
  } catch {
    // Private-browsing / storage-disabled → treat as unset. The banner will
    // reappear on every visit, which is the correct GDPR-safe default.
    return null;
  }
}

export function writeConsent(value: ConsentValue): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Swallow — private browsing users just don't get persistence. Fire the
    // event regardless so this page's PostHog provider still reacts.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { value } }));
}

/** Clear the recorded choice — surfaces the banner again on next render. */
export function resetConsent(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // See writeConsent.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { value: null } }));
}

/**
 * Subscribe to consent changes across the current tab (banner clicks, footer
 * "reset" clicks). React components use this in a `useEffect` to re-render
 * on decision. Storage events across tabs are also honored so an "Accept"
 * click in one tab wakes analytics up in every other open tab too.
 */
export function subscribeConsent(cb: (value: ConsentValue | null) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onCustom = (ev: Event): void => {
    const value = (ev as CustomEvent<{ value: ConsentValue | null }>).detail?.value ?? null;
    cb(value);
  };
  const onStorage = (ev: StorageEvent): void => {
    if (ev.key !== STORAGE_KEY) return;
    cb(ev.newValue === "accepted" || ev.newValue === "declined" ? ev.newValue : null);
  };
  window.addEventListener(CHANGE_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}
