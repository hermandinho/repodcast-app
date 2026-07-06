"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { EpisodeListFilterOptions } from "@/server/data/source";

type Props = {
  options: EpisodeListFilterOptions;
  /** Total episodes in the current tenant — drives the "All N" pill count. */
  totalAll: number;
  /** Episodes currently in `DRAFT` — drives the "Draft N" pill count. */
  totalDraft: number;
  /** Everything not in DRAFT — the review bucket. Drives "Needs review N". */
  totalReview: number;
};

/**
 * Toolbar for `/episodes` — single-line card that combines search, three
 * segmented status pills (All / Needs review / Draft), a show picker, and
 * a compact date range. Pushes URL state on change so the page server-
 * renders with the right `searchParams`; search is debounced (250 ms).
 *
 * The status pills replace the earlier full-status `<select>`. Rare
 * statuses (PROCESSING, ARCHIVED, FAILED) still route through the URL —
 * the ref intentionally simplifies to the two buckets agencies triage
 * against daily.
 */
export function EpisodeFilters({ options, totalAll, totalDraft, totalReview }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const currentSearch = params.get("q") ?? "";
  const currentShow = params.get("show") ?? "";
  const currentStatus = params.get("status") ?? "";
  const currentBucket = params.get("bucket") ?? "";
  const currentFrom = params.get("from") ?? "";
  const currentTo = params.get("to") ?? "";

  const [draft, setDraft] = useState(currentSearch);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimer.current) return;
    setDraft(currentSearch);
  }, [currentSearch]);

  const push = (next: URLSearchParams) => {
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

  // Segment == active if URL matches. `All` is the default (no filter).
  // `Needs review` uses the virtual `bucket=review` param because
  // Episode.status alone can't express "at least one pending output"
  // (see the bucket-filter docs in `server/db/episodes.ts`).
  const active: "all" | "review" | "draft" =
    currentBucket === "review"
      ? "review"
      : currentStatus === "DRAFT" || currentBucket === "drafts"
        ? "draft"
        : "all";

  const setBucketPill = (nextBucket: "" | "review" | "drafts") => {
    const next = new URLSearchParams(params.toString());
    if (nextBucket) next.set("bucket", nextBucket);
    else next.delete("bucket");
    // Bucket-filter clicks clear `status` — the two are mutually
    // exclusive routes into the same list. Legacy `?status=READY`
    // links keep working; the pill just never emits `status` itself.
    next.delete("status");
    next.delete("page");
    startTransition(() => {
      const qs = next.toString();
      router.push(qs ? `/episodes?${qs}` : "/episodes");
    });
  };

  return (
    <div className="border-border bg-surface shadow-card mb-[18px] flex flex-wrap items-center gap-[10px] rounded-2xl border px-3 py-[10px]">
      {/* Search — icon, `/` hint, subtle grey background so it reads as
          the passive default of the toolbar instead of a hard input. */}
      <div className="relative min-w-[160px] flex-1 sm:min-w-[220px]">
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-muted-2 pointer-events-none absolute top-1/2 left-[13px] -translate-y-1/2"
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
          className="bg-canvas text-ink border-border-subtle placeholder:text-muted-2 focus:border-accent-border w-full rounded-lg border py-[9px] pr-[46px] pl-[34px] font-sans text-[13px] transition-colors outline-none focus:bg-white"
        />
        <span
          className="border-border bg-surface text-muted-2 pointer-events-none absolute top-1/2 right-[10px] -translate-y-1/2 rounded-[5px] border px-[6px] py-[1px] font-mono text-[10px]"
          aria-hidden
        >
          /
        </span>
      </div>

      {/* Segmented status pills. `All` is dark-filled when active; the
          other two get a light accent tint. */}
      <div className="flex flex-shrink-0 items-center gap-[6px]">
        <StatusPill
          label="All"
          count={totalAll}
          active={active === "all"}
          onClick={() => setBucketPill("")}
        />
        <StatusPill
          label="Needs review"
          count={totalReview}
          tone="review"
          active={active === "review"}
          onClick={() => setBucketPill(active === "review" ? "" : "review")}
        />
        <StatusPill
          label="Draft"
          count={totalDraft}
          tone="draft"
          active={active === "draft"}
          onClick={() => setBucketPill(active === "draft" ? "" : "drafts")}
        />
      </div>

      <span aria-hidden className="bg-border-divider hidden h-[22px] w-px flex-shrink-0 sm:block" />

      {/* Show picker — bordered pill so it sits with the segmented row visually. */}
      <label className="border-border text-muted flex flex-shrink-0 items-center gap-[7px] rounded-lg border bg-white px-3 py-[7px] font-sans text-[12.5px] font-medium">
        <span className="text-muted-2">Show</span>
        <select
          value={currentShow}
          onChange={(e) => setParam("show", e.target.value)}
          className="text-ink cursor-pointer border-none bg-transparent font-sans text-[12.5px] font-medium outline-none"
          aria-label="Filter by show"
        >
          <option value="">All</option>
          {options.shows.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      {/* Date range — compact two-input pill; From/to labels demote the
          picker so it doesn't compete visually with search + pills.
          Hidden below md so the toolbar doesn't line-wrap awkwardly on
          phones; the query param still applies if a bookmarked URL
          carries `?from=…&to=…`. */}
      <div className="border-border text-muted hidden flex-shrink-0 items-center gap-1 rounded-lg border bg-white px-3 py-[6px] font-sans text-[12px] md:flex">
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
    </div>
  );
}

/**
 * Single status pill. Dark filled when active + `tone === undefined` (the
 * `All` case); accent-tinted when active + `tone === "review" | "draft"`.
 * Passive resting is a bordered white pill with a grey count.
 */
function StatusPill({
  label,
  count,
  tone,
  active,
  onClick,
}: {
  label: string;
  count: number;
  tone?: "review" | "draft";
  active: boolean;
  onClick: () => void;
}) {
  const base =
    "inline-flex flex-shrink-0 items-center gap-[7px] rounded-full px-[13px] py-[6px] font-sans text-[12.5px] transition-colors";
  const restingClass = "border-border text-muted-2 border bg-white hover:text-ink";
  const activeAllClass = "bg-ink font-semibold text-white";
  const activeReviewClass = "border-accent-border bg-accent-soft text-ink border font-semibold";
  const activeDraftClass = "border-border-2 bg-canvas text-ink border font-semibold";
  const chipRestingClass = "text-muted-2 text-[11.5px] font-semibold tabular-nums";
  const chipActiveAllClass = "text-white/80 text-[11.5px] font-semibold tabular-nums";
  const chipActiveTonedClass = "text-muted text-[11.5px] font-semibold tabular-nums";

  const className = active
    ? tone === "review"
      ? `${base} ${activeReviewClass}`
      : tone === "draft"
        ? `${base} ${activeDraftClass}`
        : `${base} ${activeAllClass}`
    : `${base} ${restingClass}`;

  const chipClassName = active
    ? tone === undefined
      ? chipActiveAllClass
      : chipActiveTonedClass
    : chipRestingClass;

  return (
    <button type="button" onClick={onClick} className={className} aria-pressed={active}>
      {label}
      <span className={chipClassName}>{count}</span>
    </button>
  );
}
