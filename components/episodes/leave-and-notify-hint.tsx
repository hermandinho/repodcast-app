"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

/**
 * Small in-panel hint telling the user they can safely leave the page
 * while the pipeline runs. Owner/Admin members already get a
 * completion email (see `send-completion-email` in `generate-episode`),
 * so leaving the tab is genuinely fine — this line just makes that
 * explicit and offers a browser-notification opt-in for people who
 * want a nudge if they're on the same laptop.
 *
 * `Notification.requestPermission` requires a user gesture on most
 * browsers, so we surface a button instead of asking on mount. The
 * actual notification firing lives in `outputs-view.tsx` where the
 * SSE stage transitions are observed.
 *
 * Reading `Notification.permission` is done via `useSyncExternalStore`
 * so the SSR snapshot ("unsupported") matches the initial hydrate
 * pass, then swaps to the real value after mount — no lint complaint
 * about setState-in-effect and no hydration mismatch.
 */

// The store has no external event source (browsers don't fire an event
// on permission change), but we still let callers bump a version counter
// so the value re-reads after our own `requestPermission` resolves.
let permissionVersion = 0;
const permissionListeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  permissionListeners.add(cb);
  return () => permissionListeners.delete(cb);
}

function getSnapshot(): string {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return `unsupported:${permissionVersion}`;
  }
  return `${Notification.permission}:${permissionVersion}`;
}

function getServerSnapshot(): string {
  return "unsupported:0";
}

function bumpPermission(): void {
  permissionVersion += 1;
  for (const cb of permissionListeners) cb();
}

export function LeaveAndNotifyHint() {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const permission = raw.split(":")[0] as NotificationPermission | "unsupported";
  const [asking, setAsking] = useState(false);

  const canAsk = permission === "default" && !asking;

  const onEnable = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    setAsking(true);
    try {
      await Notification.requestPermission();
    } catch {
      // Some browsers still surface only the legacy callback form —
      // ignore, the user can retry.
    } finally {
      bumpPermission();
      setAsking(false);
    }
  }, []);

  return (
    <div className="mt-[10px] flex items-center gap-[8px] text-[12px] leading-[1.55]">
      <span aria-hidden="true" className="text-muted-2">
        ✓
      </span>
      <span className="text-muted-2">
        You can leave this page — we&apos;ll email you when it&apos;s done.
      </span>
      {canAsk ? (
        <button
          type="button"
          onClick={onEnable}
          className="text-accent font-sans text-[12px] font-medium underline underline-offset-2 hover:brightness-95"
        >
          Also notify me in this browser
        </button>
      ) : permission === "granted" ? (
        <span className="text-accent font-sans text-[11.5px] font-medium">
          · Browser notifications on
        </span>
      ) : null}
    </div>
  );
}
