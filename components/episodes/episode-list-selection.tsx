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

/**
 * Three-section list:
 *   - `NEEDS REVIEW` — at least one current output is still in flight
 *     (READY / IN_REVIEW / AWAITING_CLIENT_APPROVAL). This is where the
 *     reviewer's attention should land.
 *   - `DRAFTS — NO OUTPUTS YET` — DRAFT status, or no non-superseded
 *     outputs yet. Primary action: Generate outputs.
 *   - `DONE` — has outputs, none pending. Every current output is
 *     APPROVED / SCHEDULED / PUBLISHED / FAILED (or the episode is
 *     ARCHIVED). Renders collapsed by default so a reviewer isn't
 *     wading through completed work.
 *
 * Bucketing uses `pendingReviewCount` from the server payload — driven
 * off the actual output pool, not `Episode.status` (which stops at READY
 * and never advances as outputs get approved / scheduled / published).
 * Before this, done episodes stayed pinned to Needs Review forever.
 */

const APPROVE_ROLES: MemberRole[] = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.REVIEWER];
const GENERATE_ROLES: MemberRole[] = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.EDITOR];

type BulkResultBanner =
  | { kind: "approve"; totalApproved: number; episodeCount: number }
  | { kind: "generate"; dispatchedCount: number; skippedCount: number };

const STATUS_STYLES: Record<EpisodeListStatus, { label: string; bg: string; color: string }> = {
  DRAFT: { label: "Draft", bg: "var(--color-neutral-soft)", color: "var(--color-neutral-text)" },
  PROCESSING: { label: "Processing", bg: "var(--color-accent-soft)", color: "var(--color-accent)" },
  READY: { label: "Ready", bg: "var(--color-warn-soft)", color: "var(--color-warn-text)" },
  ARCHIVED: {
    label: "Archived",
    bg: "var(--color-neutral-soft)",
    color: "var(--color-neutral-text)",
  },
  FAILED: { label: "Failed", bg: "#FBEDEC", color: "#C0392B" },
};

type Bucket = "review" | "drafts" | "done";

function bucketFor(e: EpisodeListItem): Bucket {
  if (e.status === "DRAFT" || e.outputCount === 0) return "drafts";
  if (e.pendingReviewCount > 0) return "review";
  return "done";
}

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

  const { reviewItems, draftItems, doneItems } = useMemo(() => {
    const drafts: EpisodeListItem[] = [];
    const review: EpisodeListItem[] = [];
    const done: EpisodeListItem[] = [];
    for (const e of items) {
      switch (bucketFor(e)) {
        case "drafts":
          drafts.push(e);
          break;
        case "review":
          review.push(e);
          break;
        case "done":
          done.push(e);
          break;
      }
    }
    return { reviewItems: review, draftItems: drafts, doneItems: done };
  }, [items]);
  const [showDone, setShowDone] = useState(false);

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
            : `Approved ${result.totalApproved} output${
                result.totalApproved === 1 ? "" : "s"
              } across ${result.episodeCount} episode${result.episodeCount === 1 ? "" : "s"}.`}
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

      {reviewItems.length > 0 && (
        <GroupSection
          eyebrow="Needs review"
          count={reviewItems.length}
          tone="review"
          items={reviewItems}
          selected={selected}
          selectable={selectable}
          onToggle={toggleOne}
        />
      )}

      {draftItems.length > 0 && (
        <GroupSection
          eyebrow="Drafts — no outputs yet"
          count={draftItems.length}
          tone="draft"
          items={draftItems}
          selected={selected}
          selectable={selectable}
          onToggle={toggleOne}
        />
      )}

      {doneItems.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="border-border text-muted hover:text-ink hover:bg-canvas mb-3 flex items-center gap-2 rounded-md border bg-white px-3 py-[7px] font-sans text-[12px] font-semibold transition-colors"
            aria-expanded={showDone}
          >
            <span aria-hidden>{showDone ? "▾" : "▸"}</span>
            Done
            <span className="text-muted-2 tabular-nums">{doneItems.length}</span>
          </button>
          {showDone && (
            <GroupSection
              eyebrow="Done"
              count={doneItems.length}
              tone="done"
              items={doneItems}
              selected={selected}
              selectable={selectable}
              onToggle={toggleOne}
            />
          )}
        </div>
      )}

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

/**
 * Section header (eyebrow label + count pill + hairline) followed by a
 * white card holding a stack of rows. Rendered once per bucket so the
 * two lists visually sit as peers.
 */
function GroupSection({
  eyebrow,
  count,
  tone,
  items,
  selected,
  selectable,
  onToggle,
}: {
  eyebrow: string;
  count: number;
  tone: "review" | "draft" | "done";
  items: EpisodeListItem[];
  selected: Set<string>;
  selectable: boolean;
  onToggle: (id: string) => void;
}) {
  const eyebrowColor =
    tone === "review"
      ? "var(--color-warn-text)"
      : tone === "done"
        ? "var(--color-ok-text, #1E7A47)"
        : "var(--color-muted-2)";
  const chipBg =
    tone === "review"
      ? "var(--color-warn-soft)"
      : tone === "done"
        ? "var(--color-ok-soft, #E4F3EC)"
        : "var(--color-neutral-soft)";
  const chipColor =
    tone === "review"
      ? "var(--color-warn-text)"
      : tone === "done"
        ? "var(--color-ok-text, #1E7A47)"
        : "var(--color-muted)";

  return (
    <section className="mt-6 first:mt-0">
      <div className="mb-[10px] flex items-center gap-[10px]">
        <span
          className="font-mono text-[10.5px] font-semibold tracking-[0.12em] uppercase"
          style={{ color: eyebrowColor }}
        >
          {eyebrow}
        </span>
        <span
          className="inline-flex items-center rounded-full px-[8px] py-[2px] font-sans text-[11px] font-semibold tabular-nums"
          style={{ background: chipBg, color: chipColor }}
        >
          {count}
        </span>
        <span aria-hidden className="bg-border h-px flex-1" />
      </div>
      <ul className="border-border bg-surface overflow-hidden rounded-2xl border">
        {items.map((e, i) => (
          <EpisodeRow
            key={e.id}
            episode={e}
            checked={selected.has(e.id)}
            onToggle={() => onToggle(e.id)}
            selectable={selectable}
            isLast={i === items.length - 1}
            variant={tone}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * Single episode row. Two visual variants driven by `variant`:
 *   - `review` — surfaces an amber "N to review" pill + a filled
 *     `Review →` accent button.
 *   - `draft` — greys the meta with a "No outputs generated" caption,
 *     `Draft` pill, and an outlined `Generate outputs` CTA.
 *
 * Rows share a single row shell so borders + hover states stay uniform
 * across sections. The checkbox is a sibling of the link (not nested)
 * so a checkbox click never navigates.
 */
function EpisodeRow({
  episode,
  checked,
  onToggle,
  selectable,
  isLast,
  variant,
}: {
  episode: EpisodeListItem;
  checked: boolean;
  onToggle: () => void;
  selectable: boolean;
  isLast: boolean;
  variant: "review" | "draft" | "done";
}) {
  const sm = STATUS_STYLES[episode.status];
  const rowClasses = `group hover:bg-canvas relative flex items-center gap-[14px] px-[22px] py-[14px] transition-colors ${
    isLast ? "" : "border-border-divider border-b"
  }`;

  return (
    <li>
      <div className={rowClasses}>
        {/* Left accent bar reveals on hover so users can spot which row
            they're aiming at even without a full row-tint. */}
        <span
          aria-hidden
          className="bg-accent absolute top-0 bottom-0 left-0 w-[3px] opacity-0 transition-opacity group-hover:opacity-100"
        />

        {selectable && (
          <label
            className="flex flex-shrink-0 cursor-pointer items-center"
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
          className="flex min-w-0 flex-1 items-center gap-[14px] no-underline"
        >
          <div
            className="font-display flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[10px] text-[11px] font-extrabold text-white"
            style={{ background: episode.avatarBg }}
          >
            {episode.initial}
          </div>

          <div className="min-w-0 flex-1">
            <div className="font-display text-ink truncate text-[14px] leading-tight font-bold">
              {episode.title}
            </div>
            <div className="text-muted-2 mt-[3px] flex items-center gap-[8px] truncate text-[12px]">
              <span className="text-muted font-semibold">{episode.showName}</span>
              {episode.clientName ? (
                <>
                  <span>·</span>
                  <span>{episode.clientName}</span>
                </>
              ) : null}
              <span>·</span>
              <span>{episode.createdAt}</span>
            </div>
          </div>
        </Link>

        {variant === "review" ? (
          <>
            <div className="hidden w-[150px] flex-shrink-0 sm:block">
              <div className="text-muted mb-[5px] flex justify-between text-[11px] font-semibold">
                <span>
                  {episode.pendingReviewCount} of {episode.outputCount} pending
                </span>
              </div>
              <div className="bg-border-subtle h-[5px] rounded-[3px]">
                <div
                  className="bg-accent h-[5px] rounded-[3px]"
                  style={{
                    width:
                      episode.outputCount > 0
                        ? `${Math.round(
                            ((episode.outputCount - episode.pendingReviewCount) /
                              episode.outputCount) *
                              100,
                          )}%`
                        : "4%",
                  }}
                />
              </div>
            </div>
            <span
              className="rounded-pill inline-flex flex-shrink-0 items-center gap-[6px] px-[11px] py-[4px] font-sans text-[11px] font-semibold"
              style={{ background: sm.bg, color: sm.color }}
            >
              {sm.label}
            </span>
            <Link
              href={`/episodes/${episode.id}`}
              className="bg-accent flex-shrink-0 rounded-lg px-[15px] py-[8px] font-sans text-[12.5px] font-semibold text-white no-underline transition-[filter] hover:brightness-95"
            >
              Review →
            </Link>
          </>
        ) : variant === "done" ? (
          <>
            <span className="text-muted-2 hidden flex-shrink-0 text-[12px] sm:inline">
              {episode.outputCount} outputs · nothing pending
            </span>
            <span
              className="rounded-pill inline-flex flex-shrink-0 items-center gap-[6px] px-[11px] py-[4px] font-sans text-[11px] font-semibold"
              style={{
                background: "var(--color-ok-soft, #E4F3EC)",
                color: "var(--color-ok-text, #1E7A47)",
              }}
            >
              Done
            </span>
            <Link
              href={`/episodes/${episode.id}`}
              className="border-border text-muted hover:border-accent-border hover:text-accent flex-shrink-0 rounded-lg border bg-white px-[15px] py-[7px] font-sans text-[12.5px] font-semibold no-underline transition-colors"
            >
              View
            </Link>
          </>
        ) : (
          <>
            <span className="text-muted-2 hidden flex-shrink-0 text-[12px] sm:inline">
              No outputs generated
            </span>
            <span
              className="rounded-pill inline-flex flex-shrink-0 items-center px-[11px] py-[4px] font-sans text-[11px] font-semibold"
              style={{ background: sm.bg, color: sm.color }}
            >
              {sm.label}
            </span>
            <Link
              href={`/episodes/${episode.id}`}
              className="border-border text-muted hover:border-accent-border hover:text-accent flex-shrink-0 rounded-lg border bg-white px-[15px] py-[7px] font-sans text-[12.5px] font-semibold no-underline transition-colors"
            >
              Generate outputs
            </Link>
          </>
        )}
      </div>
    </li>
  );
}
