"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = {
  /** Sub-path appended after `/root/agencies/[id]`. Empty string is the Overview tab. */
  path: string;
  label: string;
  ready?: boolean;
};

const TABS: readonly Tab[] = [
  { path: "", label: "Overview", ready: true },
  { path: "/members", label: "Members" },
  { path: "/clients", label: "Clients & shows" },
  { path: "/episodes", label: "Episodes" },
  { path: "/billing", label: "Billing" },
  { path: "/usage", label: "Usage" },
  { path: "/audit", label: "Audit" },
];

export function AgencyTabNav({ agencyId }: { agencyId: string }) {
  const pathname = usePathname();
  const base = `/root/agencies/${agencyId}`;

  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-zinc-800">
      {TABS.map((tab) => {
        const href = `${base}${tab.path}`;
        const isActive = pathname === href || (tab.path === "" && pathname === base);
        const ready = tab.ready ?? false;

        if (!ready) {
          return (
            <span
              key={tab.path}
              title="Coming next in Phase 3.6"
              className="flex cursor-not-allowed items-center gap-1 border-b-2 border-transparent px-4 py-2 text-sm text-zinc-600"
            >
              {tab.label}
              <span className="font-mono text-[9.5px] tracking-wider text-zinc-700 uppercase">
                soon
              </span>
            </span>
          );
        }

        return (
          <Link
            key={tab.path}
            href={href}
            className={[
              "border-b-2 px-4 py-2 text-sm transition-colors",
              isActive
                ? "border-red-400 font-medium text-white"
                : "border-transparent text-zinc-400 hover:text-white",
            ].join(" ")}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
