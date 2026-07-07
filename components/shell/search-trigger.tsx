"use client";

import { useSyncExternalStore } from "react";

// Stable no-op subscribe — the "is this a Mac" bit never changes at
// runtime, so we don't need real updates, just a client/server split.
function noopSubscribe() {
  return () => {};
}
function getIsMacClient() {
  // navigator.platform is deprecated but still the most reliable Mac
  // sniff in the absence of userAgentData in Safari.
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}
function getIsMacServer() {
  return false;
}

/**
 * Topbar search entry — click to open the palette, or use ⌘K / Ctrl+K.
 * On <sm the label collapses to just the magnifying glass icon so the
 * topbar stays legible on narrow screens.
 */
export function SearchTrigger({ onOpen }: { onOpen: () => void }) {
  const isMac = useSyncExternalStore(noopSubscribe, getIsMacClient, getIsMacServer);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Search"
      className="hover:bg-canvas flex h-9 items-center rounded-lg border bg-white transition-colors"
      style={{
        borderColor: "#e4e9f1",
        color: "#8B95A6",
        padding: "0 10px",
        gap: 8,
        fontFamily: "var(--font-revamp-sans)",
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden
      >
        <circle cx="7" cy="7" r="4.5" />
        <path d="m10.5 10.5 3 3" />
      </svg>
      <span className="hidden text-[13px] sm:inline">Search</span>
      <span
        aria-hidden
        className="border-border hidden rounded border px-[6px] py-[2px] text-[11px] font-semibold whitespace-nowrap sm:inline-block"
        style={{ color: "#8B95A6", background: "#F7F9FC" }}
      >
        {isMac ? "⌘K" : "Ctrl K"}
      </span>
    </button>
  );
}
