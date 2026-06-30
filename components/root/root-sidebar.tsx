"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type RootNavItem = {
  href: string;
  label: string;
  /** Whether the entry is implemented yet — disabled entries render dimmed. */
  ready?: boolean;
};

const navItems: readonly RootNavItem[] = [
  { href: "/root", label: "Overview", ready: true },
  { href: "/root/agencies", label: "Agencies" },
  { href: "/root/users", label: "Users" },
  { href: "/root/finance", label: "Finance" },
  { href: "/root/operations", label: "Operations" },
  { href: "/root/quality", label: "Quality" },
  { href: "/root/config", label: "Config" },
  { href: "/root/audit", label: "Audit log" },
  { href: "/root/system", label: "System health" },
];

function findActiveHref(pathname: string): string | null {
  let active: RootNavItem | null = null;
  for (const item of navItems) {
    const matches = pathname === item.href || pathname.startsWith(item.href + "/");
    if (!matches) continue;
    if (!active || item.href.length > active.href.length) active = item;
  }
  return active?.href ?? null;
}

export function RootSidebar() {
  const pathname = usePathname();
  const active = findActiveHref(pathname);

  return (
    <aside className="bg-sidebar text-sidebar-text flex w-[236px] flex-shrink-0 flex-col gap-1 border-r border-white/5 px-4 py-6">
      <div className="px-3 pb-6">
        <div className="font-display text-[15px] font-semibold tracking-tight text-white">
          Repodcast
        </div>
        <div className="font-mono text-[10.5px] tracking-[0.18em] text-red-400 uppercase">
          Platform admin
        </div>
      </div>

      <nav className="flex flex-col gap-[2px]">
        {navItems.map((item) => {
          const isActive = active === item.href;
          const isReady = item.ready ?? false;
          if (!isReady) {
            return (
              <span
                key={item.href}
                title="Coming next in Phase 3.6"
                className="flex cursor-not-allowed items-center justify-between rounded-[9px] px-[11px] py-[9px] text-[13.5px] text-white/30"
              >
                {item.label}
                <span className="font-mono text-[10px] tracking-wider text-white/30 uppercase">
                  soon
                </span>
              </span>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "relative flex items-center gap-[11px] rounded-[9px] px-[11px] py-[9px] text-[13.5px] transition-colors",
                isActive
                  ? "bg-white/10 font-medium text-white"
                  : "hover:bg-white/5 hover:text-white",
              ].join(" ")}
            >
              {isActive && (
                <span className="absolute top-2 bottom-2 -left-[14px] w-[3px] rounded-[3px] bg-red-400" />
              )}
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
