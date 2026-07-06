"use client";

import { useNavDrawer } from "./nav-drawer-context";

/**
 * Client-side chrome around the sidebar's server-rendered content.
 *
 * Two rendering modes driven by viewport width — no JS-side matchMedia,
 * just Tailwind classes so the mode flips at the breakpoint without a
 * re-render.
 *
 *   - `md+` (≥ 768px) — inline column at the left of the layout, always
 *     visible. Same box the pre-drawer version used.
 *   - `< md` — fixed off-canvas drawer that slides in from the left,
 *     backed by a dimmed backdrop that closes on tap. Nothing consumes
 *     horizontal room in the layout when the drawer is closed.
 *
 * The server-rendered content (nav items, user pill, unread badges) is
 * passed in as `children` so this shell stays presentational + doesn't
 * duplicate any of the server work.
 */
export function SidebarShell({ children }: { children: React.ReactNode }) {
  const { open, close } = useNavDrawer();

  return (
    <>
      {/* Backdrop — mobile only, only when open. Tap to dismiss. Kept
          outside the aside so the animated transform doesn't fight the
          fade-in. */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={close}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden ${
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        className={`bg-sidebar text-sidebar-text fixed inset-y-0 left-0 z-50 flex flex-col transition-transform md:static md:flex-shrink-0 md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
        style={{ width: "var(--sidebar-width)", fontFamily: "var(--font-revamp-sans)" }}
        aria-label="Primary navigation"
      >
        {children}
      </aside>
    </>
  );
}
