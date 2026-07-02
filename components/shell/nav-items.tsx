import type { ReactNode } from "react";

export type NavItem = {
  label: string;
  href: string;
  icon: ReactNode;
  matchPrefix?: string;
};

const stroke = "currentColor";

export const navItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke={stroke} strokeWidth="1.5">
        <rect x="2" y="2" width="5.5" height="5.5" rx="1.4" />
        <rect x="9.5" y="2" width="5.5" height="5.5" rx="1.4" />
        <rect x="2" y="9.5" width="5.5" height="5.5" rx="1.4" />
        <rect x="9.5" y="9.5" width="5.5" height="5.5" rx="1.4" />
      </svg>
    ),
  },
  {
    label: "Clients",
    href: "/clients",
    icon: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke={stroke} strokeWidth="1.5">
        <circle cx="6" cy="5.5" r="2.6" />
        <path d="M2 14c0-2.4 1.8-4 4-4s4 1.6 4 4" />
        <path d="M11 4.2a2.4 2.4 0 0 1 0 4.6" />
        <path d="M11.6 10.4c1.9.3 3.4 1.7 3.4 3.6" />
      </svg>
    ),
  },
  {
    label: "Episodes",
    href: "/episodes",
    // Match every sub-route except /episodes/new so the New-Episode entry
    // below stays the active item while the wizard is open.
    matchPrefix: "/episodes",
    icon: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke={stroke} strokeWidth="1.5">
        <rect x="2" y="3" width="13" height="11" rx="2" />
        <path d="M5.5 6h6M5.5 8.5h6M5.5 11h4" />
      </svg>
    ),
  },
  {
    label: "New Episode",
    href: "/episodes/new",
    icon: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke={stroke} strokeWidth="1.5">
        <rect x="2" y="2.5" width="13" height="12" rx="2.2" />
        <path d="M8.5 6v5M6 8.5h5" />
      </svg>
    ),
  },
  {
    label: "Voice",
    href: "/voice",
    icon: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 17 17"
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M3 8.5v0M6 5v7M9 2.5v12M12 5.5v6M15 8.5v0" />
      </svg>
    ),
  },
  {
    label: "Schedule",
    href: "/schedule",
    icon: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke={stroke} strokeWidth="1.5">
        <rect x="2.2" y="3" width="12.6" height="11.5" rx="2" />
        <path d="M2.2 6.4h12.6M5.5 1.8v2.6M11.5 1.8v2.6" />
      </svg>
    ),
  },
  {
    label: "Team",
    href: "/settings/team",
    icon: (
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke={stroke} strokeWidth="1.5">
        <circle cx="5.5" cy="6" r="2.3" />
        <circle cx="11" cy="6.6" r="2" />
        <path d="M1.8 14c0-2.2 1.7-3.6 3.7-3.6 1.2 0 2.2.5 2.9 1.3M9.4 13.2c.3-1.7 1.6-2.8 3.2-2.8 1.6 0 3 1.1 3 3" />
      </svg>
    ),
  },
  {
    label: "Settings",
    href: "/settings",
    icon: (
      <svg
        width="17"
        height="17"
        viewBox="0 0 17 17"
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M2.5 5h9M2.5 12h6" />
        <circle cx="13" cy="5" r="1.8" />
        <circle cx="10.5" cy="12" r="1.8" />
      </svg>
    ),
  },
];
