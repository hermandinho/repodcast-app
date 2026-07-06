"use client";

import { useNavDrawer } from "./nav-drawer-context";

/**
 * Mobile-only burger button that opens the sidebar drawer. Hidden at
 * `md+` where the sidebar is always visible inline. Renders inside the
 * topbar's left cluster so it sits next to the brand-adjacent copy
 * without disturbing the desktop layout.
 */
export function NavToggle() {
  const { open, toggle } = useNavDrawer();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={open ? "Close menu" : "Open menu"}
      aria-expanded={open}
      aria-controls="dashboard-sidebar"
      className="border-border text-ink hover:bg-canvas flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border bg-white transition-colors md:hidden"
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
