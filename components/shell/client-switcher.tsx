"use client";

import { usePathname } from "next/navigation";
import type { SampleShow } from "@/lib/sample-data/shows";
import { voiceBg, voiceLabel, voiceTextColor } from "@/lib/sample-data/voice-strength";

type Selected = {
  initial: string;
  initialBg: string;
  name: string;
  badge: string;
  badgeBg: string;
  badgeColor: string;
};

function selectedForPath(pathname: string, clients: SampleShow[]): Selected {
  const match = pathname.match(/^\/(?:clients|voice|episodes)\/([^/]+)/);
  if (match) {
    const client = clients.find((c) => c.key === match[1]);
    if (client) {
      return {
        initial: client.initial,
        initialBg: client.avatarBg,
        name: client.name,
        badge: `${voiceLabel(client.samples)} voice`,
        badgeBg: voiceBg(client.samples),
        badgeColor: voiceTextColor(client.samples),
      };
    }
  }
  const totalEpisodes = clients.reduce((s, c) => s + c.episodeCount, 0);
  return {
    initial: "N",
    initialBg: "#1A2A4A",
    name: "All clients",
    badge: `${clients.length} shows · ${totalEpisodes} ep`,
    badgeBg: "#EEF2FB",
    badgeColor: "#3A5BA0",
  };
}

export function ClientSwitcher({ clients }: { clients: SampleShow[] }) {
  const pathname = usePathname();
  const s = selectedForPath(pathname, clients);

  return (
    <button
      type="button"
      className="border-border bg-surface-3 text-ink hover:border-border-2 hover:bg-accent-soft flex items-center gap-[10px] rounded-[10px] border py-[6px] pr-[11px] pl-2 transition-colors"
    >
      <span
        className="font-display flex h-6 w-6 items-center justify-center rounded-[7px] text-[11px] font-bold text-white"
        style={{ background: s.initialBg }}
      >
        {s.initial}
      </span>
      <span className="max-w-[200px] truncate text-[13.5px] font-medium">{s.name}</span>
      <span
        className="rounded-pill inline-flex items-center gap-[5px] px-[7px] py-[2px] font-sans text-[10.5px] font-semibold"
        style={{ background: s.badgeBg, color: s.badgeColor }}
      >
        {s.badge}
      </span>
      <svg
        width="13"
        height="13"
        viewBox="0 0 13 13"
        fill="none"
        stroke="#5A6473"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M3.5 5l3 3 3-3" />
      </svg>
    </button>
  );
}
