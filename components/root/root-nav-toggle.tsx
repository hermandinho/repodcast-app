"use client";

import { useNavDrawer } from "@/components/shell/nav-drawer-context";

export function RootNavToggle() {
  const { open, toggle } = useNavDrawer();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={open ? "Close menu" : "Open menu"}
      aria-expanded={open}
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-red-900/40 bg-red-950/40 text-red-100 transition-colors hover:bg-red-900/50 md:hidden"
    >
      {open ? (
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M3 3l10 10M13 3L3 13" />
        </svg>
      ) : (
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M3 5h12M3 9h12M3 13h12" />
        </svg>
      )}
    </button>
  );
}
