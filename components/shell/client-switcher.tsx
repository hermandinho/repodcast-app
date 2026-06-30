"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SampleClient } from "@/lib/sample-data/clients";

/**
 * Header client picker. Resolves the active client from the URL — direct
 * for `/clients/[key]`, derived from the parent show for `/shows/[key]`
 * and `/voice/[showKey]`. Picking a client always navigates to
 * `/clients/[id]` (the client detail page).
 *
 * The component is given two arrays:
 *   - `clients` — what the dropdown lists, with each client's show count
 *     + total episode count baked in for the small badge.
 *   - `showsByKey` — used only to map a show key in the URL back to its
 *     owning client id, so the active selection survives on the
 *     `/shows/*` and `/voice/*` surfaces.
 */

export type ClientWithCounts = SampleClient & {
  /** Number of shows owned by this client. */
  showCount: number;
  /** Sum of episodes across all of this client's shows. */
  episodeCount: number;
};

type Selected = {
  /** When non-null, this picker represents a single active client. */
  client: ClientWithCounts | null;
  initial: string;
  initialBg: string;
  name: string;
  badge: string;
  badgeBg: string;
  badgeColor: string;
};

/**
 * `clients|shows|voice` are the three routes whose `[key]` slot can map
 * back to a client. (`/episodes/[id]` takes an episodeId — a different
 * shape — so we don't try to resolve it here.)
 */
const SHOW_OR_CLIENT_ROUTE = /^\/(clients|shows|voice)\/([^/]+)/;

function selectedForPath(
  pathname: string,
  clients: ClientWithCounts[],
  showsByKey: Map<string, string>,
): Selected {
  const match = pathname.match(SHOW_OR_CLIENT_ROUTE);
  if (match) {
    const prefix = match[1];
    const key = match[2];
    const clientKey = prefix === "clients" ? key : (showsByKey.get(key) ?? null);
    if (clientKey) {
      const client = clients.find((c) => c.key === clientKey);
      if (client) {
        return {
          client,
          initial: client.initial,
          initialBg: client.avatarBg,
          name: client.name,
          badge: badgeFor(client),
          badgeBg: "#EEF2FB",
          badgeColor: "#3A5BA0",
        };
      }
    }
  }
  const totalShows = clients.reduce((sum, c) => sum + c.showCount, 0);
  const totalEpisodes = clients.reduce((sum, c) => sum + c.episodeCount, 0);
  return {
    client: null,
    initial: "·",
    initialBg: "#1A2A4A",
    name: clients.length === 0 ? "No clients yet" : "All clients",
    badge:
      clients.length === 0
        ? "Add one to start"
        : `${clients.length} client${clients.length === 1 ? "" : "s"} · ${totalShows} show${totalShows === 1 ? "" : "s"} · ${totalEpisodes} ep`,
    badgeBg: "#EEF2FB",
    badgeColor: "#3A5BA0",
  };
}

function badgeFor(client: ClientWithCounts): string {
  if (client.showCount === 0) return "No shows yet";
  return `${client.showCount} show${client.showCount === 1 ? "" : "s"} · ${client.episodeCount} ep`;
}

export function ClientSwitcher({
  clients,
  showsByKey,
}: {
  clients: ClientWithCounts[];
  /**
   * Map of `showKey → clientKey`. Lets the picker stay accurate when the
   * user is on `/shows/[key]` or `/voice/[showKey]`.
   */
  showsByKey: Record<string, string>;
}) {
  const pathname = usePathname();
  const router = useRouter();

  // Stable Map so memoised hooks below don't re-derive each render.
  const showMap = useMemo(() => new Map(Object.entries(showsByKey)), [showsByKey]);
  const s = selectedForPath(pathname, clients, showMap);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return clients;
    const q = query.trim().toLowerCase();
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.contactName && c.contactName.toLowerCase().includes(q)),
    );
  }, [clients, query]);

  const pick = (client: ClientWithCounts) => {
    close();
    router.push(`/clients/${client.key}`);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
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
          className="transition-transform"
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        >
          <path d="M3.5 5l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Pick a client"
          className="border-border bg-surface shadow-card absolute top-[calc(100%+6px)] left-0 z-30 w-[340px] overflow-hidden rounded-[12px] border"
        >
          {clients.length > 4 && (
            <div className="border-border border-b p-[10px]">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter clients…"
                className="w-full rounded-[8px] px-[10px] py-[7px] font-sans text-[12.5px] text-[#2A3550] outline-none"
                style={{ border: "1px solid #C9D4E8", background: "#FBFCFE" }}
              />
            </div>
          )}
          <ul className="max-h-[360px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="text-muted-2 px-[14px] py-[18px] text-center text-[12.5px]">
                {clients.length === 0
                  ? "No clients yet — add one from the dashboard."
                  : "Nothing matches that filter."}
              </li>
            ) : (
              filtered.map((client) => {
                const active = s.client?.key === client.key;
                return (
                  <li key={client.key}>
                    <button
                      type="button"
                      onClick={() => pick(client)}
                      role="option"
                      aria-selected={active}
                      className="hover:bg-canvas flex w-full items-center gap-[10px] px-[12px] py-[9px] text-left transition-colors"
                      style={{ background: active ? "var(--color-accent-soft)" : undefined }}
                    >
                      <span
                        className="font-display flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] text-[12px] font-bold text-white"
                        style={{ background: client.avatarBg }}
                      >
                        {client.initial}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-ink block truncate text-[13px] font-semibold">
                          {client.name}
                        </span>
                        <span className="text-muted-2 mt-[1px] block truncate text-[11.5px]">
                          {client.contactName || badgeFor(client)}
                        </span>
                      </span>
                      <span
                        className="rounded-pill text-muted bg-canvas flex-shrink-0 px-[7px] py-[2px] font-sans text-[10.5px] font-semibold"
                        title={`${client.showCount} show${client.showCount === 1 ? "" : "s"} · ${client.episodeCount} episode${client.episodeCount === 1 ? "" : "s"}`}
                      >
                        {client.showCount} · {client.episodeCount}
                      </span>
                      {active && (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 14 14"
                          fill="none"
                          stroke="var(--color-accent)"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M2.5 7.2l3 3 6-6.4" />
                        </svg>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          {clients.length > 0 && (
            <div className="border-border border-t p-[8px]">
              <button
                type="button"
                onClick={() => {
                  close();
                  router.push("/clients");
                }}
                className="text-muted-2 hover:text-ink hover:bg-canvas block w-full rounded-[8px] px-[10px] py-[7px] text-left font-sans text-[12px] font-medium transition-colors"
              >
                Browse all clients →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
