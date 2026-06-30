import type { ReactNode } from "react";

/**
 * Phase 2.5 — minimal layout for the client portal.
 *
 * Deliberately bypasses the dashboard chrome (topbar, sidebar, Clerk's
 * `<UserButton>`) — clients viewing the portal aren't Repodcast users.
 * The root layout still wraps in `<ClerkProvider>` so Clerk's hooks
 * don't blow up at import time, but no auth is required to reach
 * `/portal/[token]` (see `middleware.ts`).
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return <div className="bg-canvas min-h-screen">{children}</div>;
}
