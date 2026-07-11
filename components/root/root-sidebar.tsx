"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useNavDrawer } from "@/components/shell/nav-drawer-context";

type RootNavItem = {
  href: string;
  label: string;
  /** Whether the entry is implemented yet — disabled entries render dimmed. */
  ready?: boolean;
};

const navItems: readonly RootNavItem[] = [
  { href: "/root", label: "Overview", ready: true },
  { href: "/root/agencies", label: "Agencies", ready: true },
  { href: "/root/users", label: "Users", ready: true },
  { href: "/root/finance", label: "Finance", ready: true },
  { href: "/root/operations", label: "Operations", ready: true },
  { href: "/root/quality", label: "Quality", ready: true },
  { href: "/root/feedback", label: "Feedback", ready: true },
  { href: "/root/config", label: "Config", ready: true },
  { href: "/root/emails", label: "Emails", ready: true },
  { href: "/root/blog", label: "Blog", ready: true },
  { href: "/root/audit", label: "Audit log", ready: true },
  { href: "/root/system", label: "System health", ready: true },
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
  const { open, close } = useNavDrawer();
  const active = findActiveHref(pathname);

  return (
    <>
      {/* Backdrop — mobile only, only when open. Tap to dismiss. */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={close}
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity md:hidden ${
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        aria-label="Platform admin navigation"
        className={`fixed inset-y-0 left-0 z-50 flex w-[236px] flex-shrink-0 flex-col gap-1 border-r border-white/5 bg-zinc-950 px-4 py-6 text-zinc-100 transition-transform md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="flex items-center justify-between px-3 pb-6">
          <div>
            <div className="font-display text-[15px] font-semibold tracking-tight text-white">
              Repodcast
            </div>
            <div className="font-mono text-[10.5px] tracking-[0.18em] text-red-400 uppercase">
              Platform admin
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close menu"
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/5 hover:text-white md:hidden"
          >
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
          </button>
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
    </>
  );
}
