"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItems, type NavItem } from "./nav-items";

/**
 * Pick the single most-specific nav item for the current pathname so that
 * `/episodes/new` only activates the New Episode entry (not the Episodes
 * index too). Longest matching href wins; ties don't happen in practice
 * because hrefs in `navItems` are unique.
 */
function findActiveHref(pathname: string): string | null {
  let active: NavItem | null = null;
  for (const item of navItems) {
    const matches = pathname === item.href || pathname.startsWith(item.href + "/");
    if (!matches) continue;
    if (!active || item.href.length > active.href.length) active = item;
  }
  return active?.href ?? null;
}

/**
 * Format a numeric badge for the sidebar. Anything above 99 caps to "99+"
 * so the pill never wraps onto two lines or blows out the sidebar column.
 */
function formatBadge(n: number): string {
  return n > 99 ? "99+" : String(n);
}

export function NavLink({ item, badgeCount = 0 }: { item: NavItem; badgeCount?: number }) {
  const pathname = usePathname();
  const active = findActiveHref(pathname) === item.href;

  return (
    <Link
      href={item.href}
      className="relative flex items-center no-underline transition-colors"
      style={{
        gap: 12,
        padding: "9px 12px",
        paddingLeft: active ? 10 : 12, // Compensate for the 2px left border.
        borderRadius: 8,
        fontSize: 14,
        fontWeight: active ? 600 : 400,
        color: active ? "#ffffff" : "var(--color-sidebar-text)",
        background: active ? "rgba(58,91,160,0.22)" : "transparent",
        borderLeft: active ? "2px solid var(--color-accent)" : "2px solid transparent",
      }}
    >
      {item.icon}
      <span>{item.label}</span>
      {badgeCount > 0 && (
        <span
          className="ml-auto inline-flex items-center justify-center rounded-full tabular-nums"
          style={{
            background: "var(--color-accent)",
            color: "#ffffff",
            fontSize: 10.5,
            fontWeight: 600,
            padding: "1px 7px",
          }}
          aria-label={`${badgeCount} unread`}
        >
          {formatBadge(badgeCount)}
        </span>
      )}
    </Link>
  );
}
