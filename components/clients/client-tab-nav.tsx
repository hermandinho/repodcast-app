"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Tab nav for `/clients/[key]/...`. Splits the client detail page into
 * an Overview tab (the existing voice / shows surface) and a Deliverables
 * & Billing tab (Phase 2.13). The Billing tab is OWNER/ADMIN-only — the
 * parent layout hides this entry for other roles.
 */
export function ClientTabNav({
  clientKey,
  showBillingTab,
  showStatementsTab,
}: {
  clientKey: string;
  showBillingTab: boolean;
  /** Statements are billing material — OWNER/ADMIN-only at the page level. */
  showStatementsTab: boolean;
}) {
  const pathname = usePathname();
  const base = `/clients/${clientKey}`;
  const tabs: { href: string; label: string }[] = [{ href: base, label: "Overview" }];
  if (showBillingTab) {
    tabs.push({ href: `${base}/billing`, label: "Deliverables & Billing" });
  }
  if (showStatementsTab) {
    tabs.push({ href: `${base}/statements`, label: "Statements" });
  }

  return (
    <nav
      className="border-border mb-[18px] flex items-center gap-1 border-b"
      aria-label="Client sections"
    >
      {tabs.map((tab) => {
        // Exact match on Overview; prefix match on /billing (so future
        // /billing/* sub-routes also light up the Billing tab).
        const active =
          tab.href === base
            ? pathname === base
            : pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="relative px-3 py-[10px] font-sans text-[13px] font-medium transition-colors"
            style={{
              color: active ? "var(--color-accent)" : "var(--color-muted)",
            }}
          >
            {tab.label}
            {active && (
              <span
                className="absolute inset-x-2 -bottom-[1px] h-[2px] rounded-full"
                style={{ background: "var(--color-accent)" }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
