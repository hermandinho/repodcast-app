"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { readConsent, subscribeConsent, writeConsent, type ConsentValue } from "@/lib/consent";

/**
 * Bottom-anchored cookie / analytics consent banner. Renders on every page
 * (mounted from the root layout) but only becomes visible when the visitor
 * hasn't made a choice. First-visit posture: banner up, PostHog off.
 *
 * Copy is deliberately short — GDPR requires transparency, not a wall of
 * text. The "Privacy" link points the reader at the full policy for the
 * long form.
 *
 * State comes through `useSyncExternalStore` so localStorage is the single
 * source of truth — no `setState`-in-`useEffect` shuffle.
 *
 * SSR / hydration handling: the server can't read localStorage, so we can't
 * know the user's real decision until after mount. `getServerSnapshot`
 * returns a distinct `"unknown"` sentinel (rather than `null`) so both the
 * SSR HTML and the initial hydration render treat the banner as hidden.
 * Once `getSnapshot` fires after mount, the real decision drives the
 * render. Payoff: users who've already accepted / declined never see the
 * banner flash into view on navigation. Users who haven't yet decided see
 * the banner appear one frame after hydration — imperceptible, and
 * semantically the correct posture (no tracking until they respond).
 */

type ConsentSnapshot = ConsentValue | null | "unknown";

export function ConsentBanner() {
  const consent = useSyncExternalStore<ConsentSnapshot>(
    subscribeConsent,
    readConsent,
    () => "unknown",
  );

  // Hide on SSR (`"unknown"`), after any decision (`"accepted"` /
  // `"declined"`). The banner shows only when the client-side snapshot is
  // explicitly `null` — i.e. localStorage was read and had no value.
  if (consent !== null) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie and analytics consent"
      className="fixed right-4 bottom-4 z-50 max-w-[420px] rounded-2xl border shadow-lg"
      style={{
        background: "#F7F8FB",
        borderColor: "#DDE1EA",
        boxShadow: "0 10px 40px rgba(19, 32, 59, 0.18)",
      }}
    >
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <h2
            className="m-0 text-[13.5px] font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-display)", color: "#13203B" }}
          >
            Analytics cookies
          </h2>
          <span
            className="rounded px-2 py-0.5 text-[10.5px] font-medium tracking-wider uppercase"
            style={{
              fontFamily: "var(--font-mono)",
              background: "#E7EBF3",
              color: "#4C5C7E",
              letterSpacing: "0.08em",
            }}
          >
            GDPR
          </span>
        </div>
        <p className="m-0 text-[12.5px]" style={{ color: "#4C5C7E", lineHeight: 1.55 }}>
          We use <strong style={{ color: "#2A3A5F" }}>PostHog</strong> to understand which parts of
          the site help visitors get started. Nothing loads until you say yes. See our{" "}
          <Link
            href="/legal/privacy"
            className="underline decoration-dotted underline-offset-2"
            style={{ color: "#3A5BA0" }}
          >
            Privacy Policy
          </Link>{" "}
          for what we collect and how long we keep it. You can change your mind anytime from the
          footer.
        </p>
        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => writeConsent("declined")}
            className="rounded-lg border px-3 py-2 text-[12.5px] font-medium transition-colors"
            style={{
              borderColor: "#DDE1EA",
              background: "#FFFFFF",
              color: "#4C5C7E",
            }}
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => writeConsent("accepted")}
            className="rounded-lg px-3 py-2 text-[12.5px] font-medium text-white transition-colors"
            style={{ background: "#13203B" }}
          >
            Accept analytics
          </button>
        </div>
      </div>
    </div>
  );
}
