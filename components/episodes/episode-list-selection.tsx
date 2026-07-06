"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { MemberRole } from "@/lib/enums";
import type { EpisodeListItem, EpisodeListStatus } from "@/server/data/source";
import {
  bulkApproveEpisodesAction,
  bulkGenerateEpisodesAction,
} from "@/app/(dashboard)/episodes/actions";

const STATUS_STYLES: Record<EpisodeListStatus, { label: string; bg: string; color: string }> = {
  DRAFT: { label: "Draft", bg: "#F1F4F9", color: "#7A8496" },
  PROCESSING: { label: "Processing", bg: "#EEF2FB", color: "#3A5BA0" },
  READY: { label: "Ready", bg: "#E7F4EC", color: "#1E7A47" },
  ARCHIVED: { label: "Archived", bg: "#F1F4F9", color: "#9AA3B2" },
  FAILED: { label: "Failed", bg: "#FBEDEC", color: "#C0392B" },
};

const APPROVE_ROLES: MemberRole[] = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.REVIEWER];
const GENERATE_ROLES: MemberRole[] = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.EDITOR];

type BulkResultBanner =
  | { kind: "approve"; totalApproved: number; episodeCount: number }
  | { kind: "generate"; dispatchedCount: number; skippedCount: number };

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
  const canGenerate = GENERATE_ROLES.includes(viewerRole);
  const selectable = canApprove || canGenerate;
  const selectedCount = selected.size;

  // The approve action only mutates READY/IN_REVIEW outputs — surfacing
  // the count of episodes in those states (vs. selected) keeps the bar
  // honest. Generate-eligibility tracks DRAFT/FAILED — those are the
  // only statuses the batch helper accepts (server re-validates).
  const { approveEligibleCount, generateEligibleCount } = useMemo(() => {
    let approveN = 0;
    let generateN = 0;
    for (const e of items) {
      if (!selected.has(e.id)) continue;
      if (e.status === "READY" || e.status === "PROCESSING") approveN += 1;
      if (e.status === "DRAFT" || e.status === "FAILED") generateN += 1;
    }
    return { approveEligibleCount: approveN, generateEligibleCount: generateN };
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
          kind: "approve",
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

  const onGenerate = () => {
    if (!canGenerate || selectedCount === 0) return;
    const ids = Array.from(selected);
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const r = await bulkGenerateEpisodesAction({ episodeIds: ids });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setResult({
          kind: "generate",
          dispatchedCount: r.data.dispatchedCount,
          skippedCount: r.data.skippedCount,
        });
        setSelected(new Set());
        // Server flipped rows to PROCESSING + revalidated the layout;
        // the refresh ensures the status pills re-render immediately.
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Generate failed.");
      }
    });
  };

  return (
    <>
      {(selectable || items.length > 0) && (
        <div className="text-muted-2 mb-2 flex items-center gap-3 text-[12px]">
          {selectable && (
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

      {result && result.kind === "approve" && (
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
      {result && result.kind === "generate" && (
        <div
          className="mb-3 rounded-xl border border-[#BFE3CD] bg-[#E7F4EC] px-3 py-[10px] font-sans text-[12.5px] text-[#1E7A47]"
          role="status"
        >
          {result.dispatchedCount === 0
            ? `Nothing to generate — the selected episode${
                result.skippedCount === 1 ? " isn't" : "s aren't"
              } in a draft or failed state.`
            : `Started generation for ${result.dispatchedCount} episode${
                result.dispatchedCount === 1 ? "" : "s"
              }${
                result.skippedCount > 0
                  ? ` (${result.skippedCount} skipped — not in draft or failed state)`
                  : ""
              }. Each one's outputs will land as the pipeline finishes.`}
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
            selectable={selectable}
          />
        ))}
      </ul>

      {selectable && selectedCount > 0 && (
        <div
          className="border-border bg-surface shadow-card-hover sticky bottom-4 z-20 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-[10px]"
          role="region"
          aria-label="Bulk episode actions"
        >
          <div className="text-ink font-sans text-[13px] font-medium">
            <span className="text-accent font-semibold">{selectedCount}</span> episode
            {selectedCount === 1 ? "" : "s"} selected
            {canApprove && approveEligibleCount > 0 && approveEligibleCount < selectedCount && (
              <span className="text-muted-2 ml-2 text-[12px]">
                ({approveEligibleCount} ready to approve
                {canGenerate && generateEligibleCount > 0
                  ? `, ${generateEligibleCount} ready to generate`
                  : ""}
                )
              </span>
            )}
            {(!canApprove || approveEligibleCount === 0) &&
              canGenerate &&
              generateEligibleCount > 0 &&
              generateEligibleCount < selectedCount && (
                <span className="text-muted-2 ml-2 text-[12px]">
                  ({generateEligibleCount} ready to generate)
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
            {canGenerate && generateEligibleCount > 0 && (
              <button
                type="button"
                onClick={onGenerate}
                disabled={pending}
                className="border-accent-border bg-accent-soft text-accent shadow-card flex items-center gap-[7px] rounded-md border px-[14px] py-2 font-sans text-[12.5px] font-semibold transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending
                  ? "Starting…"
                  : `Generate outputs for ${generateEligibleCount} episode${
                      generateEligibleCount === 1 ? "" : "s"
                    }`}
              </button>
            )}
            {canApprove && (
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
            )}
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
        className="group border-border bg-surface shadow-card hover:border-border-2 hover:shadow-card-hover flex min-w-0 flex-1 items-center gap-[14px] rounded-2xl border px-4 py-[14px] transition-shadow"
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
