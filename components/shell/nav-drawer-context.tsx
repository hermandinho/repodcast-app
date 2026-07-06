"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Owns the "is the mobile nav drawer open" bit for the dashboard shell.
 *
 * Client-only. Any component under `<NavDrawerProvider>` — the burger
 * button in `Topbar`, the drawer chrome in `SidebarShell` — reads this
 * context instead of prop-drilling state through Server Components.
 *
 * Behaviors baked in:
 *   - Closes automatically on route change so tapping a nav item on
 *     mobile dismisses the drawer as a byproduct of navigating.
 *   - Closes on `Escape` for keyboard parity with the marketing burger.
 *
 * `open` defaults to `false` — the drawer is closed on every fresh
 * page load. Persisting the state would just fight the user's mental
 * model on mobile where "close on nav" is the expected reset.
 */

type NavDrawerContextValue = {
  open: boolean;
  toggle: () => void;
  close: () => void;
};

const NavDrawerContext = createContext<NavDrawerContextValue | null>(null);

export function NavDrawerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  // Route change → drawer closes. Keeps the "tap a link, drawer
  // dismisses" gesture working without every NavLink calling `close`.
  // Tracks the last-seen pathname in a ref so the reset only fires on
  // an actual change (not on every render), which sidesteps the
  // `react-hooks/set-state-in-effect` rule against setting state
  // unconditionally inside useEffect.
  const lastPathnameRef = useRef(pathname);
  useEffect(() => {
    if (lastPathnameRef.current !== pathname) {
      lastPathnameRef.current = pathname;
      setOpen(false);
    }
  }, [pathname]);

  // Escape closes the drawer — mirrors the marketing nav's burger.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <NavDrawerContext.Provider value={{ open, toggle, close }}>
      {children}
    </NavDrawerContext.Provider>
  );
}

export function useNavDrawer(): NavDrawerContextValue {
  const value = useContext(NavDrawerContext);
  if (!value) {
    // Falls back to a no-op so a stray consumer outside the provider
    // (e.g. a Storybook mount) doesn't crash the render. Real usage
    // always sits inside <NavDrawerProvider>.
    return { open: false, toggle: () => {}, close: () => {} };
  }
  return value;
}
