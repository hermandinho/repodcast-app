"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings/agency", label: "Agency" },
  { href: "/settings/billing", label: "Billing" },
  { href: "/settings/team", label: "Team" },
  { href: "/settings/branding", label: "Branding" },
  { href: "/settings/integrations", label: "Integrations" },
] as const;

/**
 * Settings tab switcher — revamp visual system. Pill-style toggle rather
 * than the classic underlined tab strip: the container is a rounded
 * `#eef1f6` band, the active tab lifts to a white pill with a subtle drop
 * shadow. Non-active tabs read as muted labels inside the same band.
 */
export function SettingsNav() {
  const pathname = usePathname();
  return (
    <nav
      className="inline-flex flex-wrap items-center"
      style={{
        background: "#eef1f6",
        borderRadius: 9,
        padding: 3,
        gap: 4,
        width: "fit-content",
        marginTop: 24,
        fontFamily: "var(--font-revamp-sans)",
      }}
      aria-label="Settings sections"
    >
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className="no-underline transition-colors"
            style={{
              fontSize: 13.5,
              fontWeight: active ? 600 : 500,
              color: active ? "#0a1e3c" : "#41506b",
              background: active ? "#ffffff" : "transparent",
              padding: "7px 16px",
              borderRadius: 7,
              boxShadow: active ? "0 1px 3px rgba(10,30,60,0.10)" : "none",
            }}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
