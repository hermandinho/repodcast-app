"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { VoiceStrengthBars } from "@/components/ui/voice-strength-bars";
import { Input } from "@/components/ui/input";
import type { SampleShow } from "@/lib/sample-data/shows";
import { voiceLabel, voiceTextColor } from "@/lib/sample-data/voice-strength";

type ClientLite = { key: string; name: string };
type SortKey = "active" | "voice" | "name";

const SELECT_CLASS =
  "font-sans text-[13px] text-[#2A3550] outline-none rounded-[10px] px-[12px] py-[9px] pr-8 appearance-none cursor-pointer focus:border-[#C7D2E6] disabled:cursor-not-allowed disabled:opacity-60";
const SELECT_STYLE = {
  border: "1px solid #C9D4E8",
  background:
    "#FBFCFE url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none' stroke='%23647489' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'><path d='M1 1l4 4 4-4'/></svg>\") no-repeat right 12px center",
};

export function ShowsBrowser({ shows, clients }: { shows: SampleShow[]; clients: ClientLite[] }) {
  const [query, setQuery] = useState("");
  const [clientFilter, setClientFilter] = useState<string>("");
  const [sort, setSort] = useState<SortKey>("active");

  const clientByKey = useMemo(() => new Map(clients.map((c) => [c.key, c])), [clients]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = shows.filter((s) => {
      if (clientFilter && s.clientKey !== clientFilter) return false;
      if (!q) return true;
      const haystack = `${s.name} ${s.host}`.toLowerCase();
      return haystack.includes(q);
    });
    out.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "voice") return b.samples - a.samples;
      // "active" → episode count desc, voice samples as tiebreaker
      const ec = b.episodeCount - a.episodeCount;
      return ec !== 0 ? ec : b.samples - a.samples;
    });
    return out;
  }, [shows, query, clientFilter, sort]);

  const hasFilters = query.trim() !== "" || clientFilter !== "";
  const clearFilters = () => {
    setQuery("");
    setClientFilter("");
  };

  return (
    <>
      <div className="border-border bg-surface mb-[18px] flex flex-wrap items-center gap-3 rounded-2xl border px-[14px] py-[12px]">
        <div className="relative min-w-[220px] flex-1">
          <svg
            aria-hidden
            className="text-muted-2 pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="7" cy="7" r="5" />
            <path d="M14 14l-3.2-3.2" />
          </svg>
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search shows or hosts"
            aria-label="Search shows"
            className="py-[9px] pl-[34px]"
          />
        </div>

        <label className="text-muted-2 inline-flex items-center gap-2 font-sans text-[12px] font-semibold tracking-[0.04em] uppercase">
          <span>Client</span>
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            aria-label="Filter by client"
            className={SELECT_CLASS}
            style={SELECT_STYLE}
          >
            <option value="">All</option>
            {clients.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-muted-2 inline-flex items-center gap-2 font-sans text-[12px] font-semibold tracking-[0.04em] uppercase">
          <span>Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort shows"
            className={SELECT_CLASS}
            style={SELECT_STYLE}
          >
            <option value="active">Most episodes</option>
            <option value="voice">Voice strength</option>
            <option value="name">Name (A–Z)</option>
          </select>
        </label>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-muted-2 font-sans text-[12.5px]">
            {filtered.length === shows.length
              ? `${shows.length} show${shows.length === 1 ? "" : "s"}`
              : `${filtered.length} of ${shows.length}`}
          </span>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-accent font-sans text-[12.5px] font-semibold hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <FilteredEmptyState onClear={clearFilters} />
      ) : (
        <div
          className="grid gap-[18px]"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(296px, 1fr))" }}
        >
          {filtered.map((show) => {
            const client = clientByKey.get(show.clientKey);
            const rssConnected = Boolean(show.rssUrl);
            return (
              <Link
                key={show.key}
                href={`/shows/${show.key}`}
                className="group border-border bg-surface shadow-card hover:border-border-2 hover:shadow-card-hover block overflow-hidden rounded-3xl border text-left transition-shadow"
              >
                <div
                  className="relative h-[120px] overflow-hidden"
                  style={{ background: show.avatarBg }}
                >
                  {show.artworkUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={show.artworkUrl}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div
                      className="flex h-full w-full items-center justify-center"
                      style={{ boxShadow: "inset 0 -40px 60px rgba(0,0,0,.18)" }}
                    >
                      <span className="font-display text-[40px] font-bold tracking-[-1px] text-white/95">
                        {show.initial}
                      </span>
                    </div>
                  )}
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(to bottom, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%)",
                    }}
                  />
                  {client && (
                    <span className="absolute bottom-3 left-[14px] max-w-[60%] truncate font-sans text-[11px] font-medium tracking-[0.04em] text-white/90 uppercase">
                      {client.name}
                    </span>
                  )}
                  <div className="absolute top-3 right-3 flex items-center gap-1.5">
                    {rssConnected && (
                      <span
                        className="rounded-pill inline-flex items-center gap-[5px] bg-black/30 px-[8px] py-[3px] font-sans text-[10.5px] font-semibold tracking-[0.04em] text-white uppercase backdrop-blur-sm"
                        title="RSS feed connected"
                      >
                        <span className="h-[6px] w-[6px] rounded-full bg-[#5BD787]" />
                        RSS
                      </span>
                    )}
                    <span className="rounded-pill bg-black/30 px-[9px] py-[3px] font-sans text-[11px] font-semibold text-white backdrop-blur-sm">
                      {show.episodeCount} ep
                    </span>
                  </div>
                </div>

                <div className="p-4">
                  <div className="font-display text-ink truncate text-[15.5px] leading-tight font-semibold">
                    {show.name}
                  </div>
                  <div className="text-muted-2 mt-[3px] truncate text-[12.5px]">
                    Hosted by {show.host}
                  </div>

                  <div className="text-muted-2 mt-[10px] flex items-center justify-between text-[11.5px]">
                    <span className="inline-flex items-center gap-[5px]">
                      <svg
                        aria-hidden
                        width="11"
                        height="11"
                        viewBox="0 0 12 12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="6" cy="6" r="4.5" />
                        <path d="M6 3.5V6l1.6 1" />
                      </svg>
                      Updated {show.lastActivity}
                    </span>
                    <span
                      className="inline-flex items-center gap-[6px] font-sans font-semibold"
                      style={{ color: voiceTextColor(show.samples) }}
                    >
                      <VoiceStrengthBars samples={show.samples} size="sm" />
                      {voiceLabel(show.samples)}
                    </span>
                  </div>

                  <div className="mt-[14px] flex items-center justify-between border-t border-[#F0F3F8] pt-[10px] text-[12px]">
                    <span className="text-muted-2">
                      {show.samples} voice sample{show.samples === 1 ? "" : "s"}
                    </span>
                    <span className="text-accent font-sans font-semibold transition-transform group-hover:translate-x-[2px]">
                      Open →
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}

function FilteredEmptyState({ onClear }: { onClear: () => void }) {
  return (
    <div className="border-border bg-canvas rounded-3xl border border-dashed px-6 py-10 text-center">
      <div className="bg-accent-soft text-accent mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="M20 20l-4-4" />
        </svg>
      </div>
      <h2 className="font-display text-ink text-[16px] font-semibold">No shows match</h2>
      <p className="text-muted mx-auto mt-1 max-w-[420px] text-[13px]">
        Try a different search term or clear the filters.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="text-accent mt-3 font-sans text-[13px] font-semibold hover:underline"
      >
        Clear filters
      </button>
    </div>
  );
}
