"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { EpisodeListFilterOptions } from "@/server/data/source";

type Props = {
  options: EpisodeListFilterOptions;
};

/**
 * Filter row for /episodes. Pushes URL state on change so the page server-
 * renders with the right `searchParams`. Search input is debounced (250 ms);
 * the show/status selects fire immediately.
 *
 * Resets to page 1 on any filter change so the user doesn't land on an empty
 * trailing page after a narrowing edit.
 */
export function EpisodeFilters({ options }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const currentSearch = params.get("q") ?? "";
  const currentShow = params.get("show") ?? "";
  const currentStatus = params.get("status") ?? "";
  const currentFrom = params.get("from") ?? "";
  const currentTo = params.get("to") ?? "";

  // Local mirror so typing is responsive — flushed to URL on debounce.
  const [draft, setDraft] = useState(currentSearch);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep local state in sync when the page reloads with new params (e.g.
  // user hit back). Avoid clobbering user typing — only re-sync when
  // the URL changes while no debounce timer is pending.
  useEffect(() => {
    if (debounceTimer.current) return;
    setDraft(currentSearch);
  }, [currentSearch]);

  const push = (next: URLSearchParams) => {
    // Filters always reset to page 1 — narrowing while on page 5 is the
    // single most common way to land on an empty list.
    next.delete("page");
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `/episodes?${qs}` : "/episodes");
    });
  };

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    push(next);
  };

  const onSearchChange = (value: string) => {
    setDraft(value);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      setParam("q", value.trim());
    }, 250);
  };

  const clearAll = () => {
    setDraft("");
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    startTransition(() => router.push("/episodes"));
  };

  const hasAny = currentSearch || currentShow || currentStatus || currentFrom || currentTo;

  return (
    <div className="border-border bg-surface shadow-card mb-[18px] flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2">
      <div className="relative min-w-[220px] flex-1">
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted-2 pointer-events-none absolute top-1/2 left-[10px] -translate-y-1/2"
          aria-hidden
        >
          <circle cx="6.5" cy="6.5" r="3.5" />
          <path d="m9.5 9.5 3 3" />
        </svg>
        <input
          type="search"
          value={draft}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search episodes by title…"
          className="bg-canvas text-ink focus:border-accent-border w-full rounded-md border border-transparent py-2 pr-3 pl-8 font-sans text-[13px] transition-colors outline-none focus:bg-white"
        />
      </div>

      <select
        value={currentShow}
        onChange={(e) => setParam("show", e.target.value)}
        className="border-border text-muted rounded-md border bg-white px-3 py-2 font-sans text-[12.5px] font-medium"
        aria-label="Filter by show"
      >
        <option value="">All shows</option>
        {options.shows.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <select
        value={currentStatus}
        onChange={(e) => setParam("status", e.target.value)}
        className="border-border text-muted rounded-md border bg-white px-3 py-2 font-sans text-[12.5px] font-medium"
        aria-label="Filter by status"
      >
        <option value="">All statuses</option>
        {options.statuses.map((s) => (
          <option key={s} value={s}>
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </option>
        ))}
      </select>

      <div className="border-border text-muted flex items-center gap-1 rounded-md border bg-white px-2 py-1 font-sans text-[12px]">
        <span className="text-muted-2">From</span>
        <input
          type="date"
          value={currentFrom}
          max={currentTo || undefined}
          onChange={(e) => setParam("from", e.target.value)}
          className="text-ink rounded px-1 py-1 font-sans text-[12.5px] outline-none"
          aria-label="Filter from date"
        />
        <span className="text-muted-2">to</span>
        <input
          type="date"
          value={currentTo}
          min={currentFrom || undefined}
          onChange={(e) => setParam("to", e.target.value)}
          className="text-ink rounded px-1 py-1 font-sans text-[12.5px] outline-none"
          aria-label="Filter to date"
        />
      </div>

      {hasAny && (
        <button
          type="button"
          onClick={clearAll}
          className="text-muted-2 hover:bg-canvas hover:text-ink rounded-md px-3 py-2 font-sans text-[12.5px] font-medium transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}
