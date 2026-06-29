"use client";

import { useSyncExternalStore } from "react";

/**
 * Time-of-day greeting. SSR renders the neutral "Welcome back" so hydration
 * matches; on the client the user's local hour selects morning/afternoon/
 * evening. `useSyncExternalStore` is the React-recommended pattern for
 * values that exist only on the client — server snapshot ≠ client snapshot
 * is expected here and doesn't trigger hydration warnings.
 *
 * Why client-side: Vercel servers run in UTC, so computing the greeting on
 * the server would say "Good morning" to a Los Angeles user at 5pm. Picking
 * the bucket on the client gets it right for everyone without tracking
 * each user's timezone.
 */
const SUBSCRIBE_NOOP = () => () => {};

function getClientGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function getServerGreeting(): string {
  return "Welcome back";
}

export function Greeting({ firstName }: { firstName: string }) {
  const phrase = useSyncExternalStore(SUBSCRIBE_NOOP, getClientGreeting, getServerGreeting);

  return (
    <h1 className="font-display text-ink text-[26px] font-semibold tracking-[-0.5px]">
      {phrase}, {firstName}
    </h1>
  );
}
