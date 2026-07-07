"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import type { SearchHit, SearchResultsForUI } from "@/server/data/source";

const EMPTY: SearchResultsForUI = { clients: [], shows: [], episodes: [] };
const DEBOUNCE_MS = 150;
const MIN_QUERY = 2;

/**
 * Command palette dialog — ⌘K / Ctrl+K opens it, `/` opens it when the
 * user isn't already typing in a field. Backed by `/api/search`, which
 * returns 3 buckets (clients / shows / episodes) tenant-scoped to the
 * current agency. Keyboard nav is on a flat index over the concatenated
 * buckets so ↑/↓/Enter Just Work.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResultsForUI>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Flat index — ↑/↓ walk this. Group headers are rendered separately.
  const flat = useMemo<SearchHit[]>(
    () => [...results.clients, ...results.shows, ...results.episodes],
    [results],
  );
  const hasQuery = q.trim().length >= MIN_QUERY;
  const empty = hasQuery && !loading && flat.length === 0;

  // Reset transient state on open/close and on short queries via the
  // "setState during render" pattern (React 19-friendly) — cheaper than an
  // effect + doesn't trigger react-hooks/set-state-in-effect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setQ("");
      setResults(EMPTY);
      setActiveIndex(0);
      setLoading(false);
    }
  }
  const [prevQ, setPrevQ] = useState(q);
  if (prevQ !== q) {
    setPrevQ(q);
    // As soon as the user erases past the minimum, drop stale hits so the
    // list doesn't lag the input while the debounced fetch waits.
    if (q.trim().length < MIN_QUERY) {
      setResults(EMPTY);
      setLoading(false);
    }
  }

  // Focus the input when the palette opens. Native <dialog> autofocus
  // doesn't always land here reliably.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // Debounced fetch. Abort in-flight requests so a stale result can't
  // clobber a fresher one when the user types quickly. All setState calls
  // live inside the timer callback / promise handlers, never synchronously
  // in the effect body.
  useEffect(() => {
    if (!open) return;
    const needle = q.trim();
    if (needle.length < MIN_QUERY) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(needle)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) {
          setResults(EMPTY);
          return;
        }
        const data: SearchResultsForUI = await res.json();
        setResults(data);
        setActiveIndex(0);
      } catch (err) {
        if ((err as { name?: string }).name !== "AbortError") setResults(EMPTY);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, q]);

  const go = useCallback(
    (hit: SearchHit) => {
      onClose();
      router.push(hit.href);
    },
    [router, onClose],
  );

  // Keep the active row scrolled into view when arrowing past the fold.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length));
    } else if (e.key === "Enter") {
      const hit = flat[activeIndex];
      if (hit) {
        e.preventDefault();
        go(hit);
      }
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      ariaLabel="Search"
      className="border-border bg-surface shadow-popup fixed inset-x-0 top-[10vh] mx-auto h-fit max-h-[70vh] w-[min(640px,calc(100vw-32px))] overflow-hidden rounded-2xl border p-0 backdrop:bg-black/40"
    >
      <div onKeyDown={onKeyDown}>
        <div className="border-border flex items-center gap-3 border-b px-4 py-3">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="#8B95A6"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden
            className="flex-shrink-0"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search clients, shows, and episodes…"
            className="text-ink placeholder:text-muted-2 w-full bg-transparent text-[14px] outline-none"
            style={{ fontFamily: "var(--font-revamp-sans)" }}
            spellCheck={false}
            autoComplete="off"
          />
          <kbd
            className="text-muted-2 border-border hidden rounded border px-[6px] py-[2px] text-[11px] font-semibold sm:inline-block"
            aria-hidden
          >
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[calc(70vh-56px)] overflow-y-auto py-2">
          {!hasQuery ? (
            <div className="text-muted-2 px-4 py-6 text-center text-[13px]">
              Type at least {MIN_QUERY} characters to search.
            </div>
          ) : loading && flat.length === 0 ? (
            <div className="text-muted-2 px-4 py-6 text-center text-[13px]">Searching…</div>
          ) : empty ? (
            <div className="text-muted-2 px-4 py-6 text-center text-[13px]">
              No matches for &ldquo;{q.trim()}&rdquo;.
            </div>
          ) : (
            <>
              <ResultGroup
                label="Clients"
                items={results.clients}
                offset={0}
                activeIndex={activeIndex}
                onHover={setActiveIndex}
                onPick={go}
                renderRow={(c) => <ClientRow name={c.name} />}
              />
              <ResultGroup
                label="Shows"
                items={results.shows}
                offset={results.clients.length}
                activeIndex={activeIndex}
                onHover={setActiveIndex}
                onPick={go}
                renderRow={(s) => <ShowRow name={s.name} host={s.host} clientName={s.clientName} />}
              />
              <ResultGroup
                label="Episodes"
                items={results.episodes}
                offset={results.clients.length + results.shows.length}
                activeIndex={activeIndex}
                onHover={setActiveIndex}
                onPick={go}
                renderRow={(e) => (
                  <EpisodeRow
                    title={e.title}
                    showName={e.showName}
                    clientName={e.clientName}
                    dateLabel={e.dateLabel}
                  />
                )}
              />
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ResultGroup<T extends SearchHit>({
  label,
  items,
  offset,
  activeIndex,
  onHover,
  onPick,
  renderRow,
}: {
  label: string;
  items: T[];
  offset: number;
  activeIndex: number;
  onHover: (i: number) => void;
  onPick: (hit: T) => void;
  renderRow: (item: T) => React.ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <div className="pb-1">
      <div
        className="text-muted-2 px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide uppercase"
        style={{ fontFamily: "var(--font-revamp-sans)" }}
      >
        {label}
      </div>
      {items.map((item, i) => {
        const idx = offset + i;
        const active = idx === activeIndex;
        return (
          <button
            key={item.id}
            type="button"
            data-idx={idx}
            onMouseEnter={() => onHover(idx)}
            onClick={() => onPick(item)}
            className={[
              "flex w-full items-center gap-3 px-4 py-2 text-left transition-colors",
              active ? "bg-canvas" : "bg-transparent",
            ].join(" ")}
          >
            {renderRow(item)}
          </button>
        );
      })}
    </div>
  );
}

function ClientRow({ name }: { name: string }) {
  return (
    <>
      <KindBadge label="Client" tone="#3A5BA0" bg="#EEF2FB" />
      <div className="min-w-0 flex-1">
        <div className="text-ink truncate text-[13.5px] font-medium">{name}</div>
      </div>
    </>
  );
}

function ShowRow({ name, host, clientName }: { name: string; host: string; clientName: string }) {
  return (
    <>
      <KindBadge label="Show" tone="#2E9E5B" bg="#E7F4EC" />
      <div className="min-w-0 flex-1">
        <div className="text-ink truncate text-[13.5px] font-medium">{name}</div>
        <div className="text-muted-2 truncate text-[12px]">
          {[clientName, host].filter(Boolean).join(" · ")}
        </div>
      </div>
    </>
  );
}

function EpisodeRow({
  title,
  showName,
  clientName,
  dateLabel,
}: {
  title: string;
  showName: string;
  clientName: string;
  dateLabel: string;
}) {
  return (
    <>
      <KindBadge label="Episode" tone="#7A4FB0" bg="#F1EBF7" />
      <div className="min-w-0 flex-1">
        <div className="text-ink truncate text-[13.5px] font-medium">{title || "Untitled"}</div>
        <div className="text-muted-2 truncate text-[12px]">
          {[clientName, showName, dateLabel].filter(Boolean).join(" · ")}
        </div>
      </div>
    </>
  );
}

function KindBadge({ label, tone, bg }: { label: string; tone: string; bg: string }) {
  return (
    <span
      className="flex-shrink-0 rounded px-[7px] py-[3px] text-[10.5px] font-semibold tracking-wide uppercase"
      style={{ color: tone, background: bg, fontFamily: "var(--font-revamp-sans)" }}
    >
      {label}
    </span>
  );
}
