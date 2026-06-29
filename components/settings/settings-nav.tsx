"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings/agency", label: "Agency" },
  { href: "/settings/billing", label: "Billing" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/branding", label: "Branding" },
] as const;

export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav className="border-border mb-6 flex items-center gap-1 border-b">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            className="relative px-[14px] py-[10px] font-sans text-[13.5px] font-medium transition-colors"
            style={{
              color: active ? "var(--color-accent)" : "var(--color-muted)",
            }}
          >
            {t.label}
            {active && (
              <span className="bg-accent absolute inset-x-2 -bottom-[1px] h-[2px] rounded-full" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
