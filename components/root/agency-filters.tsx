"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

const PLAN_OPTIONS = [
  { value: "", label: "All plans" },
  { value: "STUDIO", label: "Studio" },
  { value: "AGENCY", label: "Agency" },
  { value: "NETWORK", label: "Network" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All status" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
];

const TRIAL_OPTIONS = [
  { value: "", label: "All trials" },
  { value: "active", label: "On trial" },
  { value: "converted", label: "Converted" },
  { value: "expired", label: "Expired" },
  { value: "canceled", label: "Canceled" },
];

/**
 * URL-driven filter row for `/root/agencies`. Same debounce + page-reset
 * conventions as `/episodes` so the operator's muscle memory carries over.
 */
export function AgencyFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const currentSearch = params.get("q") ?? "";
  const currentPlan = params.get("plan") ?? "";
  const currentStatus = params.get("status") ?? "";
  const currentTrial = params.get("trial") ?? "";
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
      router.push(qs ? `/root/agencies?${qs}` : "/root/agencies");
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

  const onClear = () => {
    setDraft("");
    startTransition(() => router.push("/root/agencies"));
  };

  const anyFilterActive = Boolean(
    currentSearch || currentPlan || currentStatus || currentTrial || currentFrom || currentTo,
  );

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] tracking-wider text-zinc-500 uppercase">Search</span>
        <input
          type="search"
          value={draft}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Agency name…"
          className="focus:border-accent w-56 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] tracking-wider text-zinc-500 uppercase">Plan</span>
        <select
          value={currentPlan}
          onChange={(e) => setParam("plan", e.target.value)}
          className="focus:border-accent rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 focus:outline-none"
        >
          {PLAN_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] tracking-wider text-zinc-500 uppercase">Status</span>
        <select
          value={currentStatus}
          onChange={(e) => setParam("status", e.target.value)}
          className="focus:border-accent rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 focus:outline-none"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] tracking-wider text-zinc-500 uppercase">Trial</span>
        <select
          value={currentTrial}
          onChange={(e) => setParam("trial", e.target.value)}
          className="focus:border-accent rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 focus:outline-none"
        >
          {TRIAL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] tracking-wider text-zinc-500 uppercase">
          Created from
        </span>
        <input
          type="date"
          value={currentFrom}
          max={currentTo || undefined}
          onChange={(e) => setParam("from", e.target.value)}
          className="focus:border-accent rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-mono text-[10px] tracking-wider text-zinc-500 uppercase">
          Created to
        </span>
        <input
          type="date"
          value={currentTo}
          min={currentFrom || undefined}
          onChange={(e) => setParam("to", e.target.value)}
          className="focus:border-accent rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 focus:outline-none"
        />
      </label>

      <button
        type="button"
        onClick={onClear}
        disabled={!anyFilterActive}
        className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Clear
      </button>
    </div>
  );
}
