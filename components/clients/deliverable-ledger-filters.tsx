"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { OutputStatus, Platform } from "@prisma/client";

/**
 * Phase 2.13.3 — filter row for the deliverable ledger.
 *
 * Mirrors the `/episodes` filter pattern: URL-state push, page reset on
 * every change, native date inputs cross-anchored via `min`/`max`. Server
 * renders the table from the resulting `searchParams`; this client owns
 * only the form state + the URL writes.
 */
const STATUS_OPTIONS: OutputStatus[] = [
  OutputStatus.READY,
  OutputStatus.IN_REVIEW,
  OutputStatus.APPROVED,
  OutputStatus.SCHEDULED,
  OutputStatus.PUBLISHED,
  OutputStatus.FAILED,
];

const STATUS_LABEL: Record<OutputStatus, string> = {
  GENERATING: "Generating",
  READY: "Ready",
  IN_REVIEW: "In review",
  APPROVED: "Approved",
  SCHEDULED: "Scheduled",
  PUBLISHED: "Published",
  FAILED: "Failed",
};

const PLATFORM_OPTIONS: Platform[] = [
  Platform.TWITTER,
  Platform.LINKEDIN,
  Platform.INSTAGRAM,
  Platform.TIKTOK,
  Platform.SHOW_NOTES,
  Platform.BLOG,
  Platform.NEWSLETTER,
];

const PLATFORM_LABEL: Record<Platform, string> = {
  TWITTER: "X / Twitter",
  LINKEDIN: "LinkedIn",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  SHOW_NOTES: "Show Notes",
  BLOG: "Blog",
  NEWSLETTER: "Newsletter",
};

export function DeliverableLedgerFilters({
  basePath,
  csvHref,
  csvDisabled,
}: {
  /** e.g. `/clients/cuid123/billing` — the URL where filters live. */
  basePath: string;
  /** CSV download URL pre-populated with current filters. */
  csvHref: string;
  /** Hide the Export button for non-OWNER/ADMIN roles. */
  csvDisabled: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const currentFrom = params.get("from") ?? "";
  const currentTo = params.get("to") ?? "";
  const currentPlatform = params.get("platform") ?? "";
  const currentStatus = params.get("status") ?? "";

  // Hooks have to be unconditional; this keeps the ref allocated even if
  // we never use it (no current debounced inputs, but mirrors the
  // episode-filters pattern in case we add one later).
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    },
    [],
  );

  const push = (next: URLSearchParams) => {
    next.delete("page");
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `${basePath}?${qs}` : basePath);
    });
  };

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    push(next);
  };

  const clearAll = () => {
    startTransition(() => router.push(basePath));
  };

  const hasAny = currentFrom || currentTo || currentPlatform || currentStatus;

  return (
    <div className="border-border bg-surface shadow-card mb-3 flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2">
      <div className="border-border text-muted flex items-center gap-1 rounded-md border bg-white px-2 py-1 font-sans text-[12px]">
        <span className="text-muted-2">From</span>
        <input
          type="date"
          value={currentFrom}
          max={currentTo || undefined}
          onChange={(e) => setParam("from", e.target.value)}
          className="text-ink rounded px-1 py-1 font-sans text-[12.5px] outline-none"
          aria-label="From date"
        />
        <span className="text-muted-2">to</span>
        <input
          type="date"
          value={currentTo}
          min={currentFrom || undefined}
          onChange={(e) => setParam("to", e.target.value)}
          className="text-ink rounded px-1 py-1 font-sans text-[12.5px] outline-none"
          aria-label="To date"
        />
      </div>

      <select
        value={currentPlatform}
        onChange={(e) => setParam("platform", e.target.value)}
        className="border-border text-muted rounded-md border bg-white px-3 py-2 font-sans text-[12.5px] font-medium"
        aria-label="Filter by platform"
      >
        <option value="">All platforms</option>
        {PLATFORM_OPTIONS.map((p) => (
          <option key={p} value={p}>
            {PLATFORM_LABEL[p]}
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
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>

      {hasAny && (
        <button
          type="button"
          onClick={clearAll}
          className="text-muted-2 hover:bg-canvas hover:text-ink rounded-md px-3 py-2 font-sans text-[12.5px] font-medium transition-colors"
        >
          Clear
        </button>
      )}

      <div className="ml-auto">
        {csvDisabled ? (
          <span
            className="border-border bg-canvas text-muted-2 cursor-not-allowed rounded-md border px-3 py-2 text-[12.5px] font-medium opacity-60"
            title="Only owners and admins can export the CSV."
          >
            Export CSV
          </span>
        ) : (
          <a
            href={csvHref}
            className="border-border text-accent hover:border-accent-border rounded-md border bg-white px-3 py-2 font-sans text-[12.5px] font-semibold transition-colors"
            download
          >
            Export CSV
          </a>
        )}
      </div>
    </div>
  );
}
