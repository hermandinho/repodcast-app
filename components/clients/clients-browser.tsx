"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { VoiceStrengthBars } from "@/components/ui/voice-strength-bars";
import { Input } from "@/components/ui/input";
import { voiceLabel, voiceTextColor } from "@/lib/sample-data/voice-strength";

export type ClientWithStats = {
  key: string;
  name: string;
  description: string;
  contactName: string;
  contactEmail: string;
  artworkUrl: string;
  initial: string;
  avatarBg: string;
  /** Aggregates computed server-side from this client's shows. */
  showCount: number;
  episodeCount: number;
  voiceSamples: number;
  /** Phase 3.8 — unread portal feedback for this client. Zero when the
   *  agency has no pending triage; positive counts float the card to the
   *  top of the list and render an inline pill. */
  unreadFeedback: number;
};

type SortKey = "active" | "shows" | "name";

const SORT_KEYS: readonly SortKey[] = ["active", "shows", "name"] as const;
const DEFAULT_SORT: SortKey = "active";

function parseSort(raw: string | null): SortKey {
  return (SORT_KEYS as readonly string[]).includes(raw ?? "") ? (raw as SortKey) : DEFAULT_SORT;
}

const SELECT_CLASS =
  "font-sans text-[13px] text-[#2A3550] outline-none rounded-[10px] px-[12px] py-[9px] pr-8 appearance-none cursor-pointer focus:border-[#C7D2E6] disabled:cursor-not-allowed disabled:opacity-60";
const SELECT_STYLE = {
  border: "1px solid #C9D4E8",
  background:
    "#FBFCFE url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none' stroke='%23647489' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'><path d='M1 1l4 4 4-4'/></svg>\") no-repeat right 12px center",
};

export function ClientsBrowser({ clients }: { clients: ClientWithStats[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  // URL is the source of truth — same pattern as ShowsBrowser. Search has a
  // local debounced mirror so typing isn't laggy waiting on the URL push.
  const urlQuery = params.get("q") ?? "";
  const sort = parseSort(params.get("sort"));

  const [draft, setDraft] = useState(urlQuery);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimer.current) return;
    setDraft(urlQuery);
  }, [urlQuery]);

  const pushParams = (next: URLSearchParams) => {
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `/clients?${qs}` : "/clients", { scroll: false });
    });
  };

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    pushParams(next);
  };

  const onSearchChange = (value: string) => {
    setDraft(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      setParam("q", value.trim());
    }, 250);
  };

  const filtered = useMemo(() => {
    const q = urlQuery.trim().toLowerCase();
    const out = clients.filter((c) => {
      if (!q) return true;
      const hay = `${c.name} ${c.contactName} ${c.contactEmail}`.toLowerCase();
      return hay.includes(q);
    });
    out.sort((a, b) => {
      // Phase 3.8 — clients with unread portal feedback always float to the
      // top regardless of the chosen sort. When both sides have unread, the
      // one with more pending notes wins. Everyone else drops to the
      // selected sort key below.
      const ua = a.unreadFeedback > 0 ? 1 : 0;
      const ub = b.unreadFeedback > 0 ? 1 : 0;
      if (ua !== ub) return ub - ua;
      if (ua === 1 && ub === 1) {
        const uc = b.unreadFeedback - a.unreadFeedback;
        if (uc !== 0) return uc;
      }
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "shows") {
        const sc = b.showCount - a.showCount;
        return sc !== 0 ? sc : a.name.localeCompare(b.name);
      }
      // "active" → voice samples desc, then episodes desc, then shows desc
      const vs = b.voiceSamples - a.voiceSamples;
      if (vs !== 0) return vs;
      const ec = b.episodeCount - a.episodeCount;
      if (ec !== 0) return ec;
      return b.showCount - a.showCount;
    });
    return out;
  }, [clients, urlQuery, sort]);

  const hasFilters = urlQuery.trim() !== "";
  const clearFilters = () => {
    setDraft("");
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    startTransition(() => router.replace("/clients", { scroll: false }));
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
            value={draft}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search clients or contacts"
            aria-label="Search clients"
            className="py-[9px] pl-[34px]"
          />
        </div>

        <label className="text-muted-2 inline-flex items-center gap-2 font-sans text-[12px] font-semibold tracking-[0.04em] uppercase">
          <span>Sort</span>
          <select
            value={sort}
            onChange={(e) =>
              setParam("sort", e.target.value === DEFAULT_SORT ? "" : e.target.value)
            }
            aria-label="Sort clients"
            className={SELECT_CLASS}
            style={SELECT_STYLE}
          >
            <option value="active">Most active</option>
            <option value="shows">Most shows</option>
            <option value="name">Name (A–Z)</option>
          </select>
        </label>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-muted-2 font-sans text-[12.5px]">
            {filtered.length === clients.length
              ? `${clients.length} client${clients.length === 1 ? "" : "s"}`
              : `${filtered.length} of ${clients.length}`}
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
          // 260px works down to ~340px phone viewports (card+padding fits
          // inside), while auto-fill still expands to 296-ish on desktop
          // as more room appears. Slight relaxation from the previous
          // 296px floor that was overflowing narrow phones.
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}
        >
          {filtered.map((c) => {
            const hasUnread = c.unreadFeedback > 0;
            return (
              <Link
                key={c.key}
                // Deep-link straight to the billing tab when there's unread
                // feedback, so the sidebar → /clients → card chain lands
                // exactly on the inbox rather than the client overview.
                href={hasUnread ? `/clients/${c.key}/billing` : `/clients/${c.key}`}
                className="group bg-surface shadow-card hover:shadow-card-hover block overflow-hidden rounded-3xl border p-5 transition-shadow"
                style={{
                  borderColor: hasUnread ? "#C7D2E6" : "var(--color-border)",
                  boxShadow: hasUnread ? "0 0 0 1px rgba(58,91,160,0.14) inset" : undefined,
                }}
              >
                <div className="flex items-start gap-3">
                  {c.artworkUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.artworkUrl}
                      alt=""
                      className="h-12 w-12 flex-shrink-0 rounded-xl object-cover"
                      style={{ background: "#EEF1F6" }}
                    />
                  ) : (
                    <div
                      className="font-display flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-[15px] font-bold text-white"
                      style={{ background: c.avatarBg }}
                    >
                      {c.initial}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="font-display text-ink truncate text-[16px] leading-tight font-semibold">
                        {c.name}
                      </div>
                      {hasUnread && (
                        <span
                          className="rounded-pill inline-flex flex-shrink-0 items-center gap-[5px] px-[8px] py-[2px] font-sans text-[10.5px] font-semibold tabular-nums"
                          style={{
                            background: "rgba(58,91,160,0.14)",
                            color: "#2A4A8A",
                          }}
                          aria-label={`${c.unreadFeedback} unread portal notes`}
                        >
                          <span
                            aria-hidden
                            className="inline-block h-[6px] w-[6px] rounded-full"
                            style={{ background: "#3A5BA0" }}
                          />
                          {c.unreadFeedback} new
                        </span>
                      )}
                    </div>
                    {c.contactName && (
                      <div className="text-muted-2 mt-[2px] truncate text-[12.5px]">
                        {c.contactName}
                      </div>
                    )}
                    {c.contactEmail && (
                      <div className="text-muted-2 mt-[1px] truncate text-[11.5px]">
                        {c.contactEmail}
                      </div>
                    )}
                  </div>
                </div>

                {c.description && (
                  <p className="text-muted mt-3 line-clamp-2 text-[12.5px] leading-[1.5]">
                    {c.description}
                  </p>
                )}

                <div className="text-muted-2 mt-[14px] flex items-center justify-between text-[12px]">
                  <span>
                    {c.showCount} show{c.showCount === 1 ? "" : "s"} · {c.episodeCount} episode
                    {c.episodeCount === 1 ? "" : "s"}
                  </span>
                  <span
                    className="inline-flex items-center gap-[6px] font-sans text-[11.5px] font-semibold"
                    style={{ color: voiceTextColor(c.voiceSamples) }}
                    title={`${c.voiceSamples} voice sample${c.voiceSamples === 1 ? "" : "s"}`}
                  >
                    <VoiceStrengthBars samples={c.voiceSamples} size="sm" />
                    {voiceLabel(c.voiceSamples)}
                  </span>
                </div>

                <div className="mt-3 flex items-center justify-end border-t border-[#F0F3F8] pt-3 text-[12px]">
                  <span className="text-accent font-sans font-semibold transition-transform group-hover:translate-x-[2px]">
                    {hasUnread ? "Review feedback →" : "Open →"}
                  </span>
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
          aria-hidden
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="M20 20l-4-4" />
        </svg>
      </div>
      <h2 className="font-display text-ink text-[16px] font-semibold">No clients match</h2>
      <p className="text-muted mx-auto mt-1 max-w-[420px] text-[13px]">
        Try a different search term or clear the filter.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="text-accent mt-3 font-sans text-[13px] font-semibold hover:underline"
      >
        Clear filter
      </button>
    </div>
  );
}
