"use client";

import { useEffect, useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { MemberRole } from "@/lib/enums";
import type { PlatformMeta } from "@/lib/sample-data/platforms";
import { statusMeta, type EpisodeStatus } from "@/lib/sample-data/episode-status";
import { qualityColor } from "@/lib/sample-data/quality";
import {
  listOutputVersionsAction,
  type OutputVersionSummary,
} from "@/app/(dashboard)/episodes/[id]/actions";

export type OutputState = {
  /** Grid key (stable across regens — platform key in sample mode). */
  key: string;
  /** Real DB id of the *current* version (changes on regen in live mode). */
  id: string;
  status: EpisodeStatus;
  quality: number;
  content: string;
  meta: string;
  /** Version number of the current row. */
  version: number;
  /** Total versions in this slot (>= 1). When > 1, the switcher is shown. */
  versionCount: number;
  editing: boolean;
  draft: string;
  showRegen: boolean;
  regenText: string;
  lastInstruction: string;
  progress: number;
  justCopied: boolean;
  justApproved: boolean;
  /**
   * Populated for FAILED rows from the latest OutputTransition.note. Drives
   * the per-card error UI; null/undefined when the row is not failed.
   */
  failureReason?: string | null;
};

export type OutputCardActions = {
  onCopy: () => void;
  onEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDraftChange: (next: string) => void;
  onToggleRegen: () => void;
  onRegenTextChange: (next: string) => void;
  onApplyRegen: () => void;
  onQuickRegen: (instruction: string) => void;
  onApprove: () => void;
  onRequestReview: () => void;
  onReject: () => void;
  /** Clean retry of a FAILED output — fires regenerate with no instruction. */
  onRetry: () => void;
};

const EDIT_ROLES: MemberRole[] = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.EDITOR];
const APPROVE_ROLES: MemberRole[] = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.REVIEWER];

export function OutputCard({
  platform,
  hostName,
  state,
  viewerRole,
  readOnly = false,
  actions,
}: {
  platform: PlatformMeta;
  hostName: string;
  state: OutputState;
  viewerRole: MemberRole;
  /**
   * True when the request is running under a read-only impersonation
   * envelope. Every write button is gated at the UI layer so the user
   * doesn't see optimistic success that the API is about to reject.
   */
  readOnly?: boolean;
  actions: OutputCardActions;
}) {
  const sm = statusMeta(state.status);
  const qc = qualityColor(state.quality);
  const isGen = state.status === "generating";
  const approved = state.status === "approved";
  const inReview = state.status === "review";
  const isReady = state.status === "ready";
  const isFailed = state.status === "failed";
  const canApproveStatus = isReady || inReview;

  // Role gating — pairs with server-side requireRole guards in
  // `server/db/outputs.ts`. UI just disables + tooltips when the action
  // would be rejected by the server anyway. `readOnly` collapses both
  // capabilities on top of the role check so a SystemAdmin browsing in
  // read-only impersonation sees the same UI state regardless of the
  // underlying member's role.
  const roleCanEdit = !readOnly && EDIT_ROLES.includes(viewerRole);
  const roleCanApprove = !readOnly && APPROVE_ROLES.includes(viewerRole);
  const editBlockedReason = readOnly
    ? "Read-only impersonation — writes are disabled."
    : roleCanEdit
      ? null
      : "Reviewers can't edit content — ask an Editor or Admin.";
  const approveBlockedReason = readOnly
    ? "Read-only impersonation — writes are disabled."
    : roleCanApprove
      ? null
      : "Editors can't approve — request a review instead.";

  // ---- Version switcher ----------------------------------------------------
  // `viewing` is null when the current version is shown; otherwise points at
  // an older version (read-only — actions stay scoped to the latest row).
  const [viewing, setViewing] = useState<OutputVersionSummary | null>(null);
  const [versions, setVersions] = useState<OutputVersionSummary[] | null>(null);
  const [versionsPending, startLoadVersions] = useTransition();

  const hasHistory = state.versionCount > 1;

  // Auto-fetch the version list whenever the slot has history (>= 2 versions).
  // Refires on `state.id` change (regen completed, new current row) and on
  // `state.versionCount` change (a fresh regen added a row to the chain).
  //
  // Why eager: the previous "fetch on first nav click" pattern made the
  // arrow buttons no-op on their first press — by the time the user clicked
  // again the list had loaded, which looked like a broken switcher. Loading
  // proactively when there's any history at all keeps the nav responsive.
  //
  // Also resets `viewing` to null on id change so a fresh regen lands the
  // user on the new current row, never on a dangling older selection.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewing(null);
    if (!hasHistory) {
      setVersions(null);
      return;
    }
    startLoadVersions(async () => {
      try {
        const result = await listOutputVersionsAction({ outputId: state.id });
        if (result.ok) setVersions(result.data.versions);
      } catch (err) {
        console.error("listOutputVersionsAction failed", err);
      }
    });
  }, [state.id, state.versionCount, hasHistory]);

  const onPrevVersion = () => {
    if (!versions || versions.length < 2) return;
    const currentVersion = viewing?.version ?? state.version;
    const older = versions.find((v) => v.version === currentVersion - 1);
    if (older) setViewing(older);
  };

  const onNextVersion = () => {
    if (!versions) return;
    const currentVersion = viewing?.version ?? state.version;
    if (currentVersion >= state.version) {
      setViewing(null);
      return;
    }
    const newer = versions.find((v) => v.version === currentVersion + 1);
    // Snap back to the live current row when stepping onto it, so further
    // SSE updates (status flips, edits) flow through to the card.
    setViewing(newer && !newer.isCurrent ? newer : null);
  };

  const displayedContent = viewing?.content ?? state.content;
  const displayedVersion = viewing?.version ?? state.version;
  const viewingOlder = viewing !== null;
  // Disable Prev only when truly at v1, OR when no v(N-1) exists in the
  // loaded list yet (covers the brief in-flight window before fetch lands).
  const prevDisabled =
    displayedVersion <= 1 ||
    versionsPending ||
    (versions !== null && !versions.some((v) => v.version === displayedVersion - 1));
  const nextDisabled = displayedVersion >= state.version;

  // Approved cards recede visually: no card shadow (relies on the pale
  // green border for status) and a slightly tinted background. Ready/
  // review/failed cards keep the full shadow so the reviewer's eye lands
  // on unfinished work first.
  const rootClass = approved
    ? "relative flex flex-col rounded-2xl p-4 pb-[14px]"
    : "bg-surface shadow-card relative flex flex-col rounded-2xl p-4 pb-[14px]";
  const rootStyle: CSSProperties = {
    border: `1px solid ${sm.cardBorder}`,
    ...(approved ? { background: "#F8FBF9" } : {}),
  };

  return (
    <div className={rootClass} style={rootStyle}>
      {state.justApproved && (
        <div
          className="rounded-pill absolute top-3 right-[14px] z-[5] inline-flex items-center gap-[6px] bg-[#1E7A47] px-[11px] py-[6px] font-sans text-[11.5px] font-semibold text-white"
          style={{
            boxShadow: "0 6px 18px rgba(30,122,71,.35)",
            animation: "pop .2s ease-out",
          }}
        >
          +1 voice sample · trained
        </div>
      )}

      {/* Header */}
      <div className="mb-[13px] flex items-center gap-[11px]">
        <div
          className="font-display flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-[9px] text-[13px] font-bold"
          style={{
            background: platform.badgeBg,
            color: platform.badgeColor,
            border: `1px solid ${platform.badgeBorder}`,
          }}
        >
          {platform.badge}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-ink text-[14px] leading-tight font-semibold">
            {platform.fullName}
          </div>
          <div className="text-muted-2 mt-[2px] text-[11.5px]">{state.meta}</div>
        </div>
        <span
          className="rounded-pill inline-flex flex-shrink-0 items-center gap-[6px] px-[9px] py-1 font-sans text-[11px] font-semibold"
          style={{ background: sm.bg, color: sm.color }}
        >
          <span className="block h-[6px] w-[6px] rounded-full" style={{ background: sm.color }} />
          {sm.label}
        </span>
      </div>

      {/* GENERATING */}
      {isGen && (
        <div className="pt-[6px] pb-1">
          <div className="mb-[14px] flex items-center gap-[9px]">
            <span
              className="inline-block h-[14px] w-[14px] rounded-full"
              style={{
                border: "2px solid #DCE3F0",
                borderTopColor: "#3A5BA0",
                animation: "spin .7s linear infinite",
              }}
            />
            <span className="text-accent font-sans text-[12.5px] font-medium">
              Writing in {hostName}&apos;s voice…
            </span>
          </div>
          <div className="mb-4 flex flex-col gap-[9px]">
            <div
              className="bg-accent-soft h-[9px] rounded-[5px]"
              style={{ width: "96%", animation: "shimmer 1.2s ease-in-out infinite" }}
            />
            <div
              className="bg-accent-soft h-[9px] rounded-[5px]"
              style={{
                width: "88%",
                animation: "shimmer 1.2s ease-in-out infinite",
                animationDelay: ".15s",
              }}
            />
            <div
              className="bg-accent-soft h-[9px] rounded-[5px]"
              style={{
                width: "72%",
                animation: "shimmer 1.2s ease-in-out infinite",
                animationDelay: ".3s",
              }}
            />
          </div>
          <div className="flex items-center gap-[10px]">
            <div className="h-[6px] flex-1 overflow-hidden rounded-md bg-[#EEF1F6]">
              <div
                className="bg-accent h-full rounded-md"
                style={{ width: `${Math.round(state.progress)}%` }}
              />
            </div>
            <span className="text-accent w-[36px] text-right font-sans text-[12px] font-semibold">
              {Math.round(state.progress)}%
            </span>
          </div>
        </div>
      )}

      {/* FAILED */}
      {isFailed && (
        <div className="pt-[2px] pb-1">
          <div className="mb-[12px] flex items-start gap-[10px] rounded-[10px] border border-[#F0CCC9] bg-[#FBEDEC] px-[12px] py-[10px]">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="#C0392B"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-[1px] flex-shrink-0"
              aria-hidden
            >
              <circle cx="8" cy="8" r="6.5" />
              <path d="M8 4.5v4" />
              <path d="M8 11h.01" />
            </svg>
            <div className="min-w-0">
              <div className="mb-[3px] font-sans text-[12.5px] font-semibold text-[#8A2A1F]">
                Generation failed
              </div>
              <div className="font-sans text-[12px] leading-[1.5] break-words text-[#7A2D24]">
                {state.failureReason && state.failureReason.trim().length > 0
                  ? state.failureReason
                  : "The engine couldn't finish this output. You can try again — successful platforms aren't affected."}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-2 font-sans text-[11.5px]">
              No usage was billed for this attempt.
            </span>
            <button
              type="button"
              onClick={actions.onRetry}
              disabled={!roleCanEdit}
              title={editBlockedReason ?? undefined}
              className="flex items-center gap-[7px] rounded-[9px] px-[15px] py-2 font-sans text-[13px] font-semibold text-white transition-[filter] disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: "var(--color-accent)",
                border: "1px solid rgba(0,0,0,.06)",
                boxShadow: "0 1px 2px rgba(26,42,74,.2)",
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M11.5 3.5A5 5 0 1 0 12 8" />
                <path d="M12 1.5V4H9.5" />
              </svg>
              Try again
            </button>
          </div>
        </div>
      )}

      {/* EDIT MODE */}
      {!isGen && !isFailed && state.editing && (
        <>
          <textarea
            value={state.draft}
            onChange={(e) => actions.onDraftChange(e.target.value)}
            className="h-[188px] w-full resize-y rounded-[10px] px-3 py-[11px] font-sans text-[13px] leading-[1.55] text-[#2A3550] outline-none"
            style={{ border: "1px solid #C9D4E8", background: "#FBFCFE" }}
          />
          {/* Edit-mode actions — Save/Cancel plus the same status action the
              reviewer would reach in display mode (Save & approve / Save &
              request review). The compound actions save the draft first
              then fire the status transition so a small last-mile tweak
              doesn't need a mode-switch trip. */}
          <div className="mt-[10px] flex flex-wrap items-center gap-x-2 gap-y-[8px]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={actions.onSaveEdit}
                className="bg-accent rounded-md px-[14px] py-[7px] font-sans text-[12.5px] font-semibold text-white"
              >
                Save changes
              </button>
              <button
                type="button"
                onClick={actions.onCancelEdit}
                className="border-border text-muted rounded-md border bg-white px-[14px] py-[7px] font-sans text-[12.5px] font-medium"
              >
                Cancel
              </button>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-[6px]">
              {inReview && roleCanApprove && (
                <button
                  type="button"
                  onClick={() => {
                    actions.onSaveEdit();
                    actions.onReject();
                  }}
                  className="rounded-[9px] px-[12px] py-[7px] font-sans text-[12.5px] font-semibold text-[#A06D12] transition-colors hover:bg-[#FBF1DE]"
                  style={{ border: "1px solid #E6D9B8", background: "#fff" }}
                >
                  Save & reject
                </button>
              )}

              {isReady && roleCanEdit && !roleCanApprove && (
                <button
                  type="button"
                  onClick={() => {
                    actions.onSaveEdit();
                    actions.onRequestReview();
                  }}
                  className="text-accent hover:bg-accent-soft rounded-[9px] px-[13px] py-[7px] font-sans text-[12.5px] font-semibold transition-colors"
                  style={{ border: "1px solid var(--color-accent-border)", background: "#fff" }}
                >
                  Save & request review
                </button>
              )}

              {canApproveStatus && roleCanApprove && (
                <button
                  type="button"
                  onClick={() => {
                    actions.onSaveEdit();
                    actions.onApprove();
                  }}
                  title={approveBlockedReason ?? undefined}
                  className="rounded-[9px] px-[14px] py-[7px] font-sans text-[12.5px] font-semibold text-white"
                  style={{
                    background: "var(--color-accent)",
                    border: "1px solid rgba(0,0,0,.06)",
                    boxShadow: "0 1px 2px rgba(26,42,74,.2)",
                  }}
                >
                  ✓ Save & approve
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* READY / REVIEW / APPROVED — DISPLAY MODE */}
      {!isGen && !isFailed && !state.editing && (
        <>
          {hasHistory && (
            <div className="bg-canvas mb-[10px] flex items-center justify-between gap-2 rounded-md px-[10px] py-[6px]">
              <button
                type="button"
                onClick={onPrevVersion}
                disabled={prevDisabled}
                aria-label="Previous version"
                className="text-muted hover:text-ink flex h-[22px] w-[22px] items-center justify-center rounded-md transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 11 11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M7 2.5L3.5 5.5L7 8.5" />
                </svg>
              </button>
              <span className="text-muted font-sans text-[11.5px] font-semibold">
                Version {displayedVersion} of {state.versionCount}
                {viewingOlder && (
                  <span className="rounded-pill ml-[6px] bg-[#FBF1DE] px-[7px] py-[1px] text-[10.5px] font-semibold text-[#A06D12]">
                    History
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={onNextVersion}
                disabled={nextDisabled}
                aria-label="Next version"
                className="text-muted hover:text-ink flex h-[22px] w-[22px] items-center justify-center rounded-md transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg
                  width="11"
                  height="11"
                  viewBox="0 0 11 11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 2.5L7.5 5.5L4 8.5" />
                </svg>
              </button>
            </div>
          )}

          <div className="mb-[2px] max-h-[204px] overflow-y-auto pr-[6px] font-sans text-[13px] leading-[1.6] whitespace-pre-wrap text-[#39435A]">
            {displayedContent}
          </div>

          {state.showRegen && (
            <div className="border-accent-border bg-accent-soft mt-[13px] rounded-[11px] border p-3">
              <div className="text-accent mb-[9px] font-sans text-[11.5px] font-semibold">
                Tell the engine what to change
              </div>
              <div className="mb-[9px] flex gap-2">
                <input
                  value={state.regenText}
                  onChange={(e) => actions.onRegenTextChange(e.target.value)}
                  placeholder="e.g. make it shorter, more casual, stronger hook"
                  className="flex-1 rounded-md px-[11px] py-2 font-sans text-[13px] text-[#2A3550] outline-none"
                  style={{ border: "1px solid #C9D4E8", background: "#fff" }}
                />
                <button
                  type="button"
                  onClick={actions.onApplyRegen}
                  className="bg-accent rounded-md px-[14px] py-2 font-sans text-[12.5px] font-semibold whitespace-nowrap text-white"
                >
                  Regenerate
                </button>
              </div>
              <div className="flex flex-wrap gap-[7px]">
                {["Make it shorter", "More casual", "Punchier hook"].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => actions.onQuickRegen(chip.toLowerCase().replace("make it ", ""))}
                    className="rounded-pill text-accent hover:border-accent border border-[#D6DEEC] bg-white px-[11px] py-[5px] font-sans text-[12px] font-medium transition-colors"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!state.showRegen && state.lastInstruction && (
            <div className="text-muted-2 mt-[11px] text-[11.5px] italic">
              Last regenerated: &ldquo;{state.lastInstruction}&rdquo;
            </div>
          )}

          {/* Quality meter */}
          <div className="mt-[14px] mb-[13px] flex items-center gap-[10px] border-t border-[#F0F3F8] pt-[13px]">
            <span className="text-muted-2 font-sans text-[11.5px] font-medium">Quality</span>
            <div className="h-[5px] flex-1 overflow-hidden rounded-md bg-[#EEF1F6]">
              <div
                className="h-full rounded-md"
                style={{ width: `${state.quality}%`, background: qc }}
              />
            </div>
            <span
              className="w-[26px] text-right font-sans text-[12px] font-semibold"
              style={{ color: qc }}
            >
              {state.quality}
            </span>
          </div>

          {/* Action row — icon-only secondary controls (Copy / Edit /
              Regenerate) sit tight on the left; primary status actions
              (Reject / Request review / Approve) push right and wrap onto
              their own line at narrow card widths. This replaces the older
              five-button flat row that overflowed 340 px cards whenever an
              IN_REVIEW card had both Reject and Approve visible. */}
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-[8px]">
            <div className="flex items-center gap-[2px]">
              <IconButton
                onClick={actions.onCopy}
                title={state.justCopied ? "Copied" : "Copy"}
                active={state.justCopied}
                activeColor="#1E7A47"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <rect x="4.5" y="4.5" width="7.5" height="7.5" rx="1.6" />
                  <path d="M9.5 4.5V3a1.5 1.5 0 0 0-1.5-1.5H3A1.5 1.5 0 0 0 1.5 3v5A1.5 1.5 0 0 0 3 9.5h1.5" />
                </svg>
              </IconButton>
              <IconButton
                onClick={actions.onEdit}
                disabled={viewingOlder || !roleCanEdit}
                title={editBlockedReason ?? "Edit"}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9.5 2.5l2 2-6.2 6.2-2.6.6.6-2.6 6.2-6.2z" />
                </svg>
              </IconButton>
              <IconButton
                onClick={actions.onToggleRegen}
                disabled={viewingOlder || !roleCanEdit}
                title={editBlockedReason ?? "Regenerate"}
                active={state.showRegen}
                activeColor="var(--color-accent)"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M11.5 3.5A5 5 0 1 0 12 8" />
                  <path d="M12 1.5V4H9.5" />
                </svg>
              </IconButton>
            </div>

            <div className="flex flex-wrap items-center gap-[6px]">
              {/* Reject (IN_REVIEW only, approver roles). */}
              {inReview && roleCanApprove && (
                <button
                  type="button"
                  onClick={actions.onReject}
                  disabled={viewingOlder}
                  className="flex items-center gap-[6px] rounded-[9px] px-[12px] py-[7px] font-sans text-[12.5px] font-semibold text-[#A06D12] transition-colors hover:bg-[#FBF1DE] disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ border: "1px solid #E6D9B8", background: "#fff" }}
                >
                  Reject
                </button>
              )}

              {/* Request review (READY + editor roles), OR Approve (approver
                  roles for READY/IN_REVIEW). When the viewer can do both, we
                  prefer the approve action since it's the more advanced flow. */}
              {!approved && isReady && roleCanEdit && !roleCanApprove && (
                <button
                  type="button"
                  onClick={actions.onRequestReview}
                  disabled={viewingOlder}
                  className="text-accent hover:bg-accent-soft flex items-center gap-[7px] rounded-[9px] px-[13px] py-[7px] font-sans text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ border: "1px solid var(--color-accent-border)", background: "#fff" }}
                >
                  Request review
                </button>
              )}

              <button
                type="button"
                onClick={actions.onApprove}
                disabled={!canApproveStatus || viewingOlder || !roleCanApprove}
                title={approveBlockedReason ?? undefined}
                className="flex items-center gap-[7px] rounded-[9px] px-[14px] py-[7px] font-sans text-[12.5px] font-semibold"
                style={
                  approved
                    ? {
                        background: "#E7F4EC",
                        color: "#1E7A47",
                        border: "1px solid #BFE3CD",
                        cursor: "default",
                      }
                    : canApproveStatus && !viewingOlder && roleCanApprove
                      ? {
                          background: "var(--color-accent)",
                          color: "#fff",
                          border: "1px solid rgba(0,0,0,.06)",
                          boxShadow: "0 1px 2px rgba(26,42,74,.2)",
                        }
                      : {
                          background: "#EEF1F6",
                          color: "#A6AEBD",
                          border: "1px solid #E6EBF3",
                          cursor: "not-allowed",
                        }
                }
              >
                {approved ? "✓ Approved" : canApproveStatus ? "✓ Approve" : "Approve"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Small square icon button used for the card's secondary actions (Copy /
 * Edit / Regenerate). Text is exposed as a tooltip + aria-label so the
 * buttons stay accessible without eating card width.
 */
function IconButton({
  children,
  onClick,
  title,
  disabled,
  active,
  activeColor,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  active?: boolean;
  activeColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="hover:bg-canvas flex h-[30px] w-[30px] items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      style={{ color: active ? activeColor : "#5A6473" }}
    >
      {children}
    </button>
  );
}
