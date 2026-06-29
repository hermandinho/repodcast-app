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

export function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const active = findActiveHref(pathname) === item.href;

  return (
    <Link
      href={item.href}
      className={[
        "relative flex items-center gap-[11px] rounded-[9px] px-[11px] py-[9px] text-[13.5px] transition-colors",
        active
          ? "bg-white/10 font-medium text-white"
          : "text-sidebar-text hover:bg-white/5 hover:text-white",
      ].join(" ")}
    >
      {active && (
        <span className="bg-accent absolute top-2 bottom-2 -left-[14px] w-[3px] rounded-[3px]" />
      )}
      {item.icon}
      <span>{item.label}</span>
    </Link>
  );
}
