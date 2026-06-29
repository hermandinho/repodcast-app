"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { MemberRole } from "@prisma/client";
import type { EpisodeListItem, EpisodeListStatus } from "@/server/data/source";
import { bulkApproveEpisodesAction } from "@/app/(dashboard)/episodes/actions";

const STATUS_STYLES: Record<EpisodeListStatus, { label: string; bg: string; color: string }> = {
  DRAFT: { label: "Draft", bg: "#F1F4F9", color: "#7A8496" },
  PROCESSING: { label: "Processing", bg: "#EEF2FB", color: "#3A5BA0" },
  READY: { label: "Ready", bg: "#E7F4EC", color: "#1E7A47" },
  ARCHIVED: { label: "Archived", bg: "#F1F4F9", color: "#9AA3B2" },
};

const APPROVE_ROLES: MemberRole[] = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.REVIEWER];

type BulkResultBanner = {
  totalApproved: number;
  episodeCount: number;
};

export function EpisodeListSelection({
  items,
  viewerRole,
}: {
  items: EpisodeListItem[];
  viewerRole: MemberRole;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResultBanner | null>(null);

  const canApprove = APPROVE_ROLES.includes(viewerRole);
  const selectedCount = selected.size;

  // The bulk action only mutates READY/IN_REVIEW outputs — surfacing the
  // count of episodes in those states (vs. selected) keeps the bar honest.
  const eligibleSelectedCount = useMemo(() => {
    let n = 0;
    for (const e of items) {
      if (!selected.has(e.id)) continue;
      if (e.status === "READY" || e.status === "PROCESSING") n += 1;
    }
    return n;
  }, [items, selected]);

  const toggleOne = (id: string) => {
    setError(null);
    setResult(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allOnPageIds = items.map((e) => e.id);
  const allSelected = allOnPageIds.length > 0 && allOnPageIds.every((id) => selected.has(id));
  const toggleAll = () => {
    setError(null);
    setResult(null);
    setSelected(allSelected ? new Set() : new Set(allOnPageIds));
  };

  const clear = () => {
    setSelected(new Set());
    setError(null);
    setResult(null);
  };

  const onApprove = () => {
    if (!canApprove || selectedCount === 0) return;
    const ids = Array.from(selected);
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const r = await bulkApproveEpisodesAction({ episodeIds: ids });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setResult({
          totalApproved: r.data.totalApproved,
          episodeCount: r.data.episodeCount,
        });
        setSelected(new Set());
        // The action's revalidatePath calls cover the route, but client
        // state (status pills cached above) gets refreshed too.
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Approve failed.");
      }
    });
  };

  return (
    <>
      {(canApprove || items.length > 0) && (
        <div className="text-muted-2 mb-2 flex items-center gap-3 text-[12px]">
          {canApprove && (
            <label className="inline-flex cursor-pointer items-center gap-[7px] select-none">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="border-border h-[14px] w-[14px] rounded accent-[var(--color-accent)]"
                aria-label="Select all episodes on this page"
              />
              {allSelected ? "Deselect all" : "Select all on page"}
            </label>
          )}
          {selectedCount > 0 && <span className="text-muted">{selectedCount} selected</span>}
        </div>
      )}

      {result && (
        <div
          className="mb-3 rounded-xl border border-[#BFE3CD] bg-[#E7F4EC] px-3 py-[10px] font-sans text-[12.5px] text-[#1E7A47]"
          role="status"
        >
          {result.totalApproved === 0
            ? `Nothing to approve — the ${result.episodeCount} selected episode${
                result.episodeCount === 1 ? "" : "s"
              } had no READY or IN_REVIEW outputs.`
            : `Approved ${result.totalApproved} output${result.totalApproved === 1 ? "" : "s"} across ${
                result.episodeCount
              } episode${result.episodeCount === 1 ? "" : "s"}.`}
        </div>
      )}
      {error && (
        <div className="mb-3 rounded-xl border border-[#F0CCC9] bg-[#FBEDEC] px-3 py-[10px] font-sans text-[12.5px] text-[#8A2A1F]">
          {error}
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {items.map((e) => (
          <EpisodeRow
            key={e.id}
            episode={e}
            checked={selected.has(e.id)}
            onToggle={() => toggleOne(e.id)}
            selectable={canApprove}
          />
        ))}
      </ul>

      {canApprove && selectedCount > 0 && (
        <div
          className="border-border bg-surface shadow-card-hover sticky bottom-4 z-20 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-[10px]"
          role="region"
          aria-label="Bulk approve actions"
        >
          <div className="text-ink font-sans text-[13px] font-medium">
            <span className="text-accent font-semibold">{selectedCount}</span> episode
            {selectedCount === 1 ? "" : "s"} selected
            {eligibleSelectedCount < selectedCount && (
              <span className="text-muted-2 ml-2 text-[12px]">
                ({eligibleSelectedCount} with outputs to approve)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clear}
              className="text-muted hover:bg-canvas hover:text-ink rounded-md px-3 py-2 font-sans text-[12.5px] font-medium"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={onApprove}
              disabled={pending}
              className="bg-accent shadow-card flex items-center gap-[7px] rounded-md px-[14px] py-2 font-sans text-[12.5px] font-semibold text-white transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending
                ? "Approving…"
                : `Approve all READY outputs in ${selectedCount} episode${
                    selectedCount === 1 ? "" : "s"
                  }`}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function EpisodeRow({
  episode,
  checked,
  onToggle,
  selectable,
}: {
  episode: EpisodeListItem;
  checked: boolean;
  onToggle: () => void;
  selectable: boolean;
}) {
  const sm = STATUS_STYLES[episode.status];

  // The checkbox is a sibling of the link, not inside it — clicking the
  // checkbox must not navigate. We use a flex row with the link filling
  // the remaining space.
  return (
    <li className="flex items-stretch gap-2">
      {selectable && (
        <label
          className="flex flex-shrink-0 cursor-pointer items-center px-1"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            className="border-border h-[16px] w-[16px] rounded accent-[var(--color-accent)]"
            aria-label={`Select ${episode.title}`}
          />
        </label>
      )}
      <Link
        href={`/episodes/${episode.id}`}
        className="group border-border bg-surface shadow-card hover:border-border-2 hover:shadow-card-hover flex flex-1 items-center gap-[14px] rounded-2xl border px-4 py-[14px] transition-shadow"
      >
        <div
          className="font-display flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-xl text-[13.5px] font-bold text-white"
          style={{ background: episode.avatarBg }}
        >
          {episode.initial}
        </div>

        <div className="min-w-0 flex-1">
          <div className="font-display text-ink truncate text-[14.5px] leading-tight font-semibold">
            {episode.title}
          </div>
          <div className="text-muted-2 mt-[3px] truncate text-[12px]">
            {episode.showName}
            {episode.clientName ? ` · ${episode.clientName}` : ""}
            {" · "}
            {episode.outputCount} output{episode.outputCount === 1 ? "" : "s"}
            {" · "}
            {episode.createdAt}
          </div>
        </div>

        <span
          className="rounded-pill inline-flex flex-shrink-0 items-center gap-[6px] px-[10px] py-1 font-sans text-[11px] font-semibold"
          style={{ background: sm.bg, color: sm.color }}
        >
          <span className="block h-[6px] w-[6px] rounded-full" style={{ background: sm.color }} />
          {sm.label}
        </span>

        <span className="text-accent hidden text-[12.5px] font-semibold transition-transform group-hover:translate-x-[2px] sm:inline">
          Open →
        </span>
      </Link>
    </li>
  );
}
