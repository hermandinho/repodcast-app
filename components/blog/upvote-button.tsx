"use client";

import { useCallback, useState, useSyncExternalStore, useTransition } from "react";

/**
 * Anonymous upvote toggle for `/blog/[slug]`. Mounts inside the RSC post
 * page as a plain inline button.
 *
 * State model:
 *   - `voted` — derived from `localStorage` via `useSyncExternalStore` so
 *     SSR renders "not voted" (server has no storage) and hydration
 *     reconciles once the browser is in play. Same-tab updates broadcast
 *     via a custom event; cross-tab updates ride the built-in `storage`
 *     event.
 *   - `count` — locally-displayed count. Seeded from `initialCount` (the
 *     server value at render time). Updated optimistically on toggle so
 *     the UI reflects the click before the network round-trip completes.
 *
 * ISR caveat: the page is `revalidate = 300`, so `initialCount` can lag
 * the true DB value by up to 5 minutes. That's fine — the button's job is
 * to accept a click and reflect it visually; the eventually-consistent DB
 * counter catches up on the next revalidation.
 *
 * Bot exclusion happens server-side (`/api/blog/[slug]/upvote` UA regex).
 * We don't try to detect bots client-side — they mostly don't run JS.
 */

const STORAGE_PREFIX = "blogvote:";
const CHANGE_EVENT_PREFIX = "blogvote-changed:";

function storageKey(slug: string): string {
  return `${STORAGE_PREFIX}${slug}`;
}

function readVoted(slug: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(slug)) !== null;
  } catch {
    // localStorage can throw in private mode / storage-blocked browsers.
    // Falling through leaves the button in the un-voted state — the
    // reader can still vote; we just can't dedup for them.
    return false;
  }
}

export function BlogUpvoteButton({
  slug,
  initialCount,
}: {
  slug: string;
  initialCount: number;
}): React.ReactElement {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const eventName = `${CHANGE_EVENT_PREFIX}${slug}`;
      const onCustom = () => onChange();
      // Cross-tab: the browser fires `storage` for OTHER tabs, not the
      // one that wrote. Same-tab: we dispatch a custom event from the
      // click handler because `storage` won't cover us there.
      const onStorage = (e: StorageEvent) => {
        if (e.key === storageKey(slug)) onChange();
      };
      window.addEventListener(eventName, onCustom);
      window.addEventListener("storage", onStorage);
      return () => {
        window.removeEventListener(eventName, onCustom);
        window.removeEventListener("storage", onStorage);
      };
    },
    [slug],
  );
  const getSnapshot = useCallback(() => readVoted(slug), [slug]);
  const voted = useSyncExternalStore(
    subscribe,
    getSnapshot,
    // Server snapshot — no localStorage, so default to "not voted".
    // Mismatch is intentional and resolves on hydration.
    () => false,
  );

  const [count, setCount] = useState(initialCount);
  const [pending, startTransition] = useTransition();

  const onClick = () => {
    if (pending) return;

    const nextVoted = !voted;
    const nextCount = Math.max(0, count + (nextVoted ? 1 : -1));

    // Optimistic UI first — the click feels instant even on slow networks.
    setCount(nextCount);
    try {
      if (nextVoted) window.localStorage.setItem(storageKey(slug), "1");
      else window.localStorage.removeItem(storageKey(slug));
      // Fire the subscription so `voted` re-derives from storage without
      // waiting for another tab's `storage` event.
      window.dispatchEvent(new Event(`${CHANGE_EVENT_PREFIX}${slug}`));
    } catch {
      // Ignore storage failures — the count is still updated for this
      // session, we just can't persist across navigation.
    }

    startTransition(async () => {
      try {
        await fetch(`/api/blog/${encodeURIComponent(slug)}/upvote`, {
          method: nextVoted ? "POST" : "DELETE",
          keepalive: true,
        });
      } catch {
        // Silent — a lost vote isn't worth surfacing. The next reader
        // interaction will retry via a fresh click if they care.
      }
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={voted}
      aria-label={voted ? "Remove upvote" : "Upvote this post"}
      className={[
        "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-medium transition-colors",
        voted
          ? "border-[#3A5BA0] bg-[#3A5BA0] text-white shadow-sm"
          : "border-[#DDE2EE] bg-white text-[#3A5BA0] hover:border-[#3A5BA0]",
        pending ? "opacity-80" : "",
      ].join(" ")}
      style={{ fontFamily: "var(--font-mono)" }}
    >
      <ArrowUp filled={voted} />
      <span className="tabular-nums">
        {count} {count === 1 ? "upvote" : "upvotes"}
      </span>
    </button>
  );
}

function ArrowUp({ filled }: { filled: boolean }): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M7 2.5L11.5 8H9v3.5H5V8H2.5L7 2.5Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </svg>
  );
}
