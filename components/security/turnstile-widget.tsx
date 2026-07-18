"use client";

import { useEffect, useId, useRef } from "react";

/**
 * Cloudflare Turnstile widget. Loads the Turnstile script once per page,
 * renders an invisible/managed challenge, and calls `onToken` with the
 * one-shot response token — pass that back to the server action, which
 * verifies via `verifyTurnstile()`.
 *
 * Env-missing posture: when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is unset,
 * we render nothing and immediately call `onToken("")`. The server-side
 * verify is a no-op in the same condition, so the form still submits
 * end-to-end in local dev without a Cloudflare account.
 */

type TurnstileWidgetProps = {
  onToken: (token: string) => void;
  onError?: () => void;
  onExpire?: () => void;
  /** Cloudflare theme — pass "light" or "dark" to match the page. */
  theme?: "light" | "dark" | "auto";
};

// Minimal window shim — the real Turnstile SDK exposes a wider surface
// but this is all we call.
declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        opts: {
          sitekey: string;
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        },
      ) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId?: string) => void;
    };
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

/**
 * Track script-load state at module scope so multiple widgets on one
 * page share one <script> tag and one pending-load promise.
 */
let scriptState: "idle" | "loading" | "loaded" = "idle";
let pendingLoad: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (scriptState === "loaded") return Promise.resolve();
  if (pendingLoad) return pendingLoad;

  scriptState = "loading";
  pendingLoad = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => {
        scriptState = "loaded";
        resolve();
      });
      existing.addEventListener("error", () => reject(new Error("turnstile script failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.addEventListener("load", () => {
      scriptState = "loaded";
      resolve();
    });
    s.addEventListener("error", () => reject(new Error("turnstile script failed")));
    document.head.appendChild(s);
  });
  return pendingLoad;
}

export function TurnstileWidget({
  onToken,
  onError,
  onExpire,
  theme = "light",
}: TurnstileWidgetProps) {
  const containerId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    // No site key → dev / unconfigured. Signal "no challenge needed" by
    // handing back an empty token; the server-side verify is a no-op in
    // the same condition.
    if (!siteKey) {
      onToken("");
      return;
    }

    let disposed = false;

    loadTurnstileScript()
      .then(() => {
        if (disposed || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme,
          callback: (token) => onToken(token),
          "error-callback": () => onError?.(),
          "expired-callback": () => {
            onToken("");
            onExpire?.();
          },
        });
      })
      .catch((err) => {
        console.warn("[turnstile] failed to load", err);
        onError?.();
      });

    return () => {
      disposed = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Ignore — the widget may have been torn down by React first.
        }
      }
    };
    // Only re-render if the key or theme changes — the callbacks
    // intentionally aren't deps because the parent may pass fresh
    // closures on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, theme]);

  if (!siteKey) return null;
  return <div id={containerId} ref={containerRef} />;
}
