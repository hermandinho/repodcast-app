"use client";

import type { CSSProperties } from "react";
import { MemberRole } from "@/lib/enums";
import { statusMeta, type EpisodeStatus } from "@/lib/sample-data/episode-status";
import type { PlatformMeta } from "@/lib/sample-data/platforms";

/**
 * Phase 3.3+ revamp (see ref/card1.png) — compact tile for the grid.
 *
 * The card itself is display-only + one primary CTA. Every richer surface
 * (full content, edit textarea, regenerate box, schedule form, version
 * history, secondary actions) lives in the details drawer that opens
 * when the card is clicked. `outputs-view.tsx` owns the drawer state so
 * one drawer instance handles all cards.
 *
 * State-driven visual language:
 *   ready       → white bg, green Approve primary
 *   review      → amber-tinted bg, green Approve primary
 *   approved    → mint-tinted bg, purple Schedule primary
 *   scheduled   → blue-tinted bg, primary depends on external scheduler
 *   published   → green-tinted bg, "View post ↗" link
 *   failed      → red-tinted bg, Try again primary
 *   generating  → white bg, animated skeleton
 */

export type OutputState = {
  key: string;
  id: string;
  status: EpisodeStatus;
  quality: number;
  content: string;
  meta: string;
  version: number;
  versionCount: number;
  editing: boolean;
  draft: string;
  showRegen: boolean;
  regenText: string;
  lastInstruction: string;
  progress: number;
  justCopied: boolean;
  justApproved: boolean;
  failureReason?: string | null;
  scheduledForIso?: string | null;
  publishedAtIso?: string | null;
  externalScheduler?: "BUFFER" | "MANUAL" | null;
  externalPostUrl?: string | null;
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
  onRetry: () => void;
};

const APPROVE_ROLES: MemberRole[] = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.REVIEWER];
const EDIT_ROLES: MemberRole[] = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.EDITOR];
const SCHEDULE_ROLES: MemberRole[] = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.EDITOR];

type VoiceBand = { label: string; color: string; bg: string };
function voiceBandFromQuality(q: number): VoiceBand {
  if (q >= 85) return { label: "Strong", color: "#1F8A5B", bg: "#DCF0E5" };
  if (q >= 72) return { label: "Growing", color: "#3A5BA0", bg: "#DDE5F4" };
  if (q > 0) return { label: "Learning", color: "#A06D12", bg: "#FBF1DE" };
  return { label: "New", color: "#5A6473", bg: "#E4E8F0" };
}

/**
 * Card tint per status. Kept subtle — the CTA is the load-bearing
 * color signal, the tint is just the mood.
 */
function tintFor(status: EpisodeStatus): string {
  switch (status) {
    case "approved":
      return "#F5FBF7";
    case "scheduled":
      return "#F5F7FE";
    case "published":
      return "#F0FAF3";
    case "failed":
      return "#FDF5F4";
    case "review":
      return "#FDFAF3";
    default:
      return "#FFFFFF";
  }
}

export function OutputCard({
  platform,
  state,
  viewerRole,
  readOnly = false,
  onOpen,
  actions,
  bufferConnected: _bufferConnected = false,
  bufferConnectedPlatforms: _bufferConnectedPlatforms = [],
  episodeId: _episodeId,
}: {
  platform: PlatformMeta;
  hostName: string;
  state: OutputState;
  episodeId: string;
  viewerRole: MemberRole;
  readOnly?: boolean;
  bufferConnected?: boolean;
  bufferConnectedPlatforms?: import("@prisma/client").Platform[];
  actions: OutputCardActions;
  /** Fired when the user clicks anywhere on the card except the primary
   *  CTA. The parent opens the drawer for `state.key`. */
  onOpen?: () => void;
}) {
  void _bufferConnected;
  void _bufferConnectedPlatforms;
  void _episodeId;

  const sm = statusMeta(state.status);
  const isGen = state.status === "generating";
  const isFailed = state.status === "failed";
  const isReady = state.status === "ready";
  const inReview = state.status === "review";
  const approved = state.status === "approved";
  const isScheduled = state.status === "scheduled";
  const isPublished = state.status === "published";
  const isLocked = isScheduled || isPublished;

  const roleCanEdit = !readOnly && EDIT_ROLES.includes(viewerRole) && !isLocked;
  const roleCanApprove = !readOnly && APPROVE_ROLES.includes(viewerRole) && !isLocked;
  const roleCanSchedule = !readOnly && SCHEDULE_ROLES.includes(viewerRole);

  const voice = voiceBandFromQuality(state.quality);
  const tint = tintFor(state.status);

  const rootStyle: CSSProperties = {
    background: tint,
    borderColor: sm.cardBorder,
  };

  // Wrapper is a button so keyboard users can open the drawer. Buttons
  // inside the card's action band use stopPropagation to avoid dbl-fires.
  const openable = !isGen && onOpen;

  return (
    <div
      role={openable ? "button" : undefined}
      tabIndex={openable ? 0 : undefined}
      onClick={openable ? onOpen : undefined}
      onKeyDown={
        openable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      className={`relative flex flex-col overflow-hidden rounded-2xl border transition-colors ${
        openable ? "hover:brightness-[0.99]" : ""
      } ${state.justApproved ? "" : ""}`}
      style={rootStyle}
    >
      {state.justApproved && (
        <div
          className="rounded-pill absolute top-2.5 right-2.5 z-[5] inline-flex items-center gap-[6px] bg-[#1E7A47] px-[10px] py-[5px] font-sans text-[10.5px] font-semibold text-white"
          style={{ boxShadow: "0 6px 18px rgba(30,122,71,.35)", animation: "pop .2s ease-out" }}
        >
          ✓ trained
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2.5 px-3.5 pt-3.5 pb-2.5">
        <div
          className="font-display flex h-[28px] w-[28px] flex-shrink-0 items-center justify-center rounded-[8px] text-[11.5px] font-bold"
          style={{
            background: platform.badgeBg,
            color: platform.badgeColor,
            border: `1px solid ${platform.badgeBorder}`,
          }}
        >
          {platform.badge}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-ink truncate text-[13px] leading-tight font-semibold">
            {platform.fullName}
          </div>
        </div>
        <StatusPill sm={sm} />
      </div>

      {/* Content preview OR generating skeleton */}
      <div className="flex-1 px-3.5 pb-2.5">
        {isGen ? (
          <GeneratingPreview progress={state.progress} />
        ) : isFailed ? (
          <FailedPreview reason={state.failureReason ?? null} />
        ) : (
          <p className="text-muted line-clamp-3 min-h-[52px] text-[12.5px] leading-[1.55] whitespace-pre-wrap">
            {state.content}
          </p>
        )}
      </div>

      {/* Metric chips */}
      {!isGen && !isFailed && (
        <div className="flex items-center gap-1.5 px-3.5 pb-3">
          <span
            className="rounded-md px-2 py-0.5 font-mono text-[10.5px] font-semibold"
            style={{
              background: "#EEF1F6",
              color: "#3A4557",
            }}
          >
            Quality {state.quality || "—"}
          </span>
          <span
            className="rounded-md px-2 py-0.5 font-mono text-[10.5px] font-semibold"
            style={{
              background: voice.bg,
              color: voice.color,
            }}
          >
            {voice.label}
          </span>
        </div>
      )}

      {/* Action band — one primary CTA per state, plus optional secondary
          link. Every button stops the card-click bubble so the drawer
          doesn't open on top of the fired action. */}
      {!isGen && (
        <div className="border-t px-3.5 py-2.5" style={{ borderColor: "rgba(0,0,0,.05)" }}>
          <ActionBand
            state={state.status}
            isReady={isReady}
            inReview={inReview}
            approved={approved}
            isScheduled={isScheduled}
            isPublished={isPublished}
            isFailed={isFailed}
            externalScheduler={state.externalScheduler ?? null}
            externalPostUrl={state.externalPostUrl ?? null}
            roleCanEdit={roleCanEdit}
            roleCanApprove={roleCanApprove}
            roleCanSchedule={roleCanSchedule}
            onApprove={actions.onApprove}
            onRequestReview={actions.onRequestReview}
            onReject={actions.onReject}
            onRetry={actions.onRetry}
            onOpen={onOpen}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================
// Sub-views
// ============================================================

function StatusPill({ sm }: { sm: ReturnType<typeof statusMeta> }) {
  return (
    <span
      className="rounded-pill inline-flex flex-shrink-0 items-center gap-[5px] px-[8px] py-[2px] font-sans text-[10.5px] font-semibold"
      style={{ background: sm.bg, color: sm.color }}
    >
      <span className="block h-[5px] w-[5px] rounded-full" style={{ background: sm.color }} />
      {sm.label}
    </span>
  );
}

function GeneratingPreview({ progress }: { progress: number }) {
  return (
    <div className="min-h-[52px] pt-1">
      <div className="mb-3 flex flex-col gap-[7px]">
        <div
          className="bg-accent-soft h-[8px] rounded-[4px]"
          style={{ width: "96%", animation: "shimmer 1.2s ease-in-out infinite" }}
        />
        <div
          className="bg-accent-soft h-[8px] rounded-[4px]"
          style={{
            width: "84%",
            animation: "shimmer 1.2s ease-in-out infinite",
            animationDelay: ".15s",
          }}
        />
        <div
          className="bg-accent-soft h-[8px] rounded-[4px]"
          style={{
            width: "62%",
            animation: "shimmer 1.2s ease-in-out infinite",
            animationDelay: ".3s",
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <div className="h-[4px] flex-1 overflow-hidden rounded-md bg-[#EEF1F6]">
          <div
            className="bg-accent h-full rounded-md"
            style={{
              width: `${Math.max(4, Math.min(100, progress))}%`,
              transition: "width .35s ease",
            }}
          />
        </div>
        <span className="text-muted-2 font-mono text-[9.5px] tabular-nums">
          {Math.round(progress)}%
        </span>
      </div>
    </div>
  );
}

function FailedPreview({ reason }: { reason: string | null }) {
  return (
    <div className="rounded-lg border border-[#F0CCC9] bg-[#FBEDEC] px-2.5 py-2">
      <div className="text-[11.5px] font-semibold text-[#C0392B]">Generation failed</div>
      {reason ? (
        <div className="text-muted mt-1 line-clamp-2 text-[11px] leading-[1.4]">{reason}</div>
      ) : null}
    </div>
  );
}

// ============================================================
// Action band — state-driven single primary CTA
// ============================================================

function ActionBand(p: {
  state: EpisodeStatus;
  isReady: boolean;
  inReview: boolean;
  approved: boolean;
  isScheduled: boolean;
  isPublished: boolean;
  isFailed: boolean;
  externalScheduler: "BUFFER" | "MANUAL" | null;
  externalPostUrl: string | null;
  roleCanEdit: boolean;
  roleCanApprove: boolean;
  roleCanSchedule: boolean;
  onApprove: () => void;
  onRequestReview: () => void;
  onReject: () => void;
  onRetry: () => void;
  onOpen?: () => void;
}) {
  const stop = (e: React.MouseEvent | React.KeyboardEvent) => e.stopPropagation();
  const clickWithStop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  if (p.isFailed) {
    return (
      <PrimaryButton
        tone="danger"
        label="Try again"
        onClick={clickWithStop(p.onRetry)}
        disabled={!p.roleCanEdit}
      />
    );
  }

  if (p.isPublished) {
    if (p.externalPostUrl) {
      return (
        <a
          href={p.externalPostUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={stop}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border py-2 font-sans text-[12.5px] font-semibold transition-colors"
          style={{
            borderColor: "#BEDDBA",
            background: "#DBEDD9",
            color: "#166534",
          }}
        >
          View post ↗
        </a>
      );
    }
    return (
      <div className="text-muted-2 py-2 text-center text-[11.5px]">Published — no live link</div>
    );
  }

  if (p.isScheduled) {
    // Buffer-backed rows sync via cron — the primary CTA is "View in Buffer"
    // when we have the URL, else nothing (user just waits).
    // Manual rows get "Mark published" as the primary action.
    const isManual = p.externalScheduler !== "BUFFER";
    if (isManual && p.roleCanSchedule) {
      return (
        <div className="flex flex-col gap-1.5">
          <PrimaryButton
            tone="success"
            label="Mark published"
            onClick={clickWithStop(() => p.onOpen?.())}
          />
          <SecondaryLink
            label="Unschedule"
            onClick={clickWithStop(() => p.onOpen?.())}
            disabled={!p.roleCanSchedule}
          />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1.5">
        {p.externalPostUrl ? (
          <a
            href={p.externalPostUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={stop}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border py-2 font-sans text-[12.5px] font-semibold transition-colors"
            style={{
              borderColor: "#D1DAF0",
              background: "#F5F7FE",
              color: "#2A3F6B",
            }}
          >
            View in Buffer ↗
          </a>
        ) : (
          <div className="text-muted-2 py-2 text-center text-[11.5px]">Publishing via Buffer…</div>
        )}
        <SecondaryLink
          label="Unschedule"
          onClick={clickWithStop(() => p.onOpen?.())}
          disabled={!p.roleCanSchedule}
        />
      </div>
    );
  }

  if (p.approved) {
    return (
      <div className="flex flex-col gap-1.5">
        <PrimaryButton
          tone="brand"
          label="Schedule"
          onClick={clickWithStop(() => p.onOpen?.())}
          disabled={!p.roleCanSchedule}
        />
      </div>
    );
  }

  // Ready or in-review — both terminate with Approve.
  return (
    <div className="flex flex-col gap-1.5">
      <PrimaryButton
        tone="success"
        label="Approve"
        onClick={clickWithStop(p.onApprove)}
        disabled={!p.roleCanApprove}
      />
      {p.inReview ? (
        <SecondaryLink
          label="Reject"
          onClick={clickWithStop(p.onReject)}
          disabled={!p.roleCanApprove}
        />
      ) : (
        <SecondaryLink
          label="Request review"
          onClick={clickWithStop(p.onRequestReview)}
          disabled={!p.roleCanEdit}
        />
      )}
    </div>
  );
}

function PrimaryButton({
  label,
  onClick,
  disabled = false,
  tone,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  tone: "success" | "brand" | "danger";
}) {
  const toneStyle: Record<typeof tone, CSSProperties> = {
    success: {
      background: "#1F8A5B",
      color: "#fff",
      border: "1px solid rgba(0,0,0,.06)",
      boxShadow: "0 1px 2px rgba(31,138,91,.22)",
    },
    brand: {
      background: "#6D5EF5",
      color: "#fff",
      border: "1px solid rgba(0,0,0,.06)",
      boxShadow: "0 1px 2px rgba(109,94,245,.22)",
    },
    danger: {
      background: "#C0392B",
      color: "#fff",
      border: "1px solid rgba(0,0,0,.06)",
      boxShadow: "0 1px 2px rgba(192,57,43,.22)",
    },
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-md py-2 font-sans text-[12.5px] font-semibold transition-[filter] hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-50"
      style={toneStyle[tone]}
    >
      {label}
    </button>
  );
}

function SecondaryLink({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-muted hover:text-ink w-full py-[3px] text-center text-[11.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  );
}
