"use client";

import type { CSSProperties } from "react";
import { MemberRole } from "@/lib/enums";
import { statusMeta, type EpisodeStatus } from "@/lib/sample-data/episode-status";
import type { PlatformMeta } from "@/lib/sample-data/platforms";

/**
 * Phase 3.3+ revamp (see ref/UI/Episode Details/details-full.html) — compact
 * tile for the grid. Layout matches the reference exactly:
 *
 *   ┌─────────────────────────────────────────┐
 *   │ [BADGE]  Title                 [PILL]   │  ← header
 *   │          THREAD · 6 POSTS               │
 *   ├─────────────────────────────────────────┤
 *   │ ┌─────────────────────────── [Open →] ┐ │
 *   │ │ Body preview…                        │ │  ← click-to-open preview
 *   │ │ …fades toward the bottom             │ │     with fade mask
 *   │ └──────────────────────────────────────┘ │
 *   │ (96) Quality       ▁▂▃  Strong          │  ← signals row
 *   │ ┌─────────────────────┐ ┌──────────────┐│
 *   │ │ Approve             │ │  Request…    ││  ← primary + secondary
 *   │ └─────────────────────┘ └──────────────┘│
 *   └─────────────────────────────────────────┘
 *
 * All filled primary CTAs share the app's accent navy (`--color-accent`) —
 * the ref uses green for Approve / Mark published, but the user asked for
 * the current theme instead, so every finalizing action reads the same.
 * The card is always white; state signaling lives in the header status
 * pill, not the card background.
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
  /** Non-null when the end client has final-approved via the portal —
   *  terminal freeze, no one on the agency side may edit or regen. */
  clientApprovedAtIso?: string | null;
  /** Non-null while the output is sitting in the client's portal awaiting
   *  their approval decision. Paired with `status === "awaiting-client"`. */
  sentToClientAtIso?: string | null;
  /** Populated when the client hit "Request revision" in the portal on
   *  this row and the agency hasn't followed up yet. Server derives this
   *  from the row's latest OutputTransition — cleared by any subsequent
   *  approve / request-review / regen. Drives the "Client asked for
   *  changes" chip in the header so the agency knows which of the
   *  currently READY outputs is actually the flagged one. */
  clientRevisionRequestedAtIso?: string | null;
  clientRevisionNote?: string | null;
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
/** Only editors see the "Request review" affordance. Owners, admins, and
 *  reviewers are the approvers — they don't request review of themselves.
 *  Mirrors `REQUEST_REVIEW_ROLES` in `server/db/outputs.ts`. */
const REQUEST_REVIEW_ROLES: MemberRole[] = [MemberRole.EDITOR];

type VoiceBand = { label: string; color: string; muted: string };
function voiceBandFromQuality(q: number): VoiceBand {
  if (q >= 85) return { label: "Strong", color: "#1F8A5B", muted: "#D8DEE8" };
  if (q >= 72) return { label: "Growing", color: "#3A5BA0", muted: "#D8DEE8" };
  if (q > 0) return { label: "Developing", color: "#B7791F", muted: "#D8DEE8" };
  return { label: "New", color: "#8A93A3", muted: "#D8DEE8" };
}

/** Quality score color — mirrors the ref's `qColor(q)` helper so the
 *  circle around the score, the score itself, and the drawer's Quality
 *  box all read as the same tone. */
function qualityColor(q: number): string {
  if (q >= 90) return "#1F8A5B";
  if (q >= 75) return "#B7791F";
  return "#C0392B";
}

export function OutputCard({
  platform,
  state,
  viewerRole,
  clientValidationMode = "INTERNAL",
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
  /** Parent client's validation flow. Drives post-approval edit gating:
   *  INTERNAL → OWNER can still edit after APPROVED; CLIENT → frozen once
   *  sent to client. Mirrors `canEditOutput` in `server/db/outputs.ts`. */
  clientValidationMode?: "INTERNAL" | "CLIENT";
  readOnly?: boolean;
  bufferConnected?: boolean;
  bufferConnectedPlatforms?: import("@prisma/client").Platform[];
  actions: OutputCardActions;
  /** Fired when the user clicks the body preview OR a secondary action
   *  that needs the drawer's larger surface (Unschedule, Mark published
   *  manual flow, etc.). */
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
  const awaitingClient = state.status === "awaiting-client";
  const approved = state.status === "approved";
  const isScheduled = state.status === "scheduled";
  const isPublished = state.status === "published";
  const isLocked = isScheduled || isPublished;
  const clientApproved = Boolean(state.clientApprovedAtIso);

  // Post-approval edit rules mirror `canEditOutput` on the server:
  // - `clientApprovedAtIso` set → frozen for everyone forever.
  // - `awaiting-client` → frozen (out of the agency's hands).
  // - `approved` + INTERNAL mode → OWNER only.
  // - `approved` + CLIENT mode → frozen (either the client approves or
  //   asks for revision; the agency can't tweak in the meantime).
  // - `ready` / `review` → standard EDIT_ROLES set.
  const canEditInState = (() => {
    if (readOnly || isLocked || clientApproved || awaitingClient) return false;
    if (approved) {
      if (clientValidationMode === "CLIENT") return false;
      return viewerRole === MemberRole.OWNER;
    }
    if (isReady || inReview) return EDIT_ROLES.includes(viewerRole);
    return false;
  })();

  const roleCanEdit = canEditInState;
  const roleCanApprove =
    !readOnly && APPROVE_ROLES.includes(viewerRole) && !isLocked && !awaitingClient;
  const roleCanRequestReview =
    !readOnly && REQUEST_REVIEW_ROLES.includes(viewerRole) && !isLocked && !awaitingClient;
  const roleCanSchedule = !readOnly && SCHEDULE_ROLES.includes(viewerRole);

  const voice = voiceBandFromQuality(state.quality);
  const qColor = qualityColor(state.quality);

  return (
    <div
      className="group relative flex h-[376px] flex-col overflow-hidden rounded-2xl border-[1.5px] bg-white transition-[border-color,transform,box-shadow] duration-150 ease-out hover:-translate-y-[3px] hover:border-[#C7D0E0] hover:shadow-[0_14px_32px_-20px_rgba(26,42,74,0.35)]"
      style={{
        borderColor: "#EAEDF3",
        boxShadow: "0 1px 2px rgba(26,42,74,0.04)",
      }}
    >
      {state.justApproved && (
        <div
          className="rounded-pill absolute top-2.5 right-2.5 z-[5] inline-flex items-center gap-[6px] bg-[#1E7A47] px-[10px] py-[5px] font-sans text-[10.5px] font-semibold text-white"
          style={{ boxShadow: "0 6px 18px rgba(30,122,71,.35)", animation: "pop .2s ease-out" }}
        >
          ✓ trained
        </div>
      )}

      {/* Header — badge tile + title/meta + status pill */}
      <div className="flex items-center gap-[11px] px-4 pt-4 pb-[14px]">
        <div
          className="font-display flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[10px] text-[15px] font-bold"
          style={{
            background: platform.badgeBg,
            color: platform.badgeColor,
            border: `1px solid ${platform.badgeBorder}`,
          }}
        >
          {platform.badge}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-display text-ink truncate text-[14.5px] leading-tight font-semibold tracking-[-0.01em]">
            {platform.fullName}
          </div>
          <div className="text-muted-2 mt-0.5 truncate font-mono text-[10.5px] tracking-[0.02em] uppercase">
            {state.meta}
          </div>
        </div>
        {isReady && state.clientRevisionRequestedAtIso ? (
          <RevisionRequestedPill />
        ) : (
          <StatusPill sm={sm} />
        )}
      </div>

      {/* Revision-request note strip. Appears when the client hit "Request
          revision" in the portal — replaces the "Ready" status semantics
          with an actionable signal so the agency knows which of the
          currently READY cards is actually flagged. Only shown when a
          note was submitted — a note-less request already flips the pill,
          the strip is for surfacing the client's rationale. */}
      {isReady && state.clientRevisionRequestedAtIso && state.clientRevisionNote ? (
        <div
          className="mx-4 mb-[10px] rounded-[8px] px-3 py-[7px] text-[11.5px] leading-[1.45] text-[#7A3128]"
          style={{ background: "#FBEDEC", border: "1px solid #F0CFC2" }}
        >
          <span className="font-semibold">Note:</span>{" "}
          <span className="line-clamp-2">{state.clientRevisionNote}</span>
        </div>
      ) : null}

      {/* Content preview — click-to-open with fade mask + "Open →" chip.
          Failed / generating states swap out the preview box entirely. */}
      {isGen ? (
        <div className="mx-4 flex-1">
          <GeneratingPreview progress={state.progress} />
        </div>
      ) : isFailed ? (
        <div className="mx-4 flex-1">
          <FailedPreview reason={state.failureReason ?? null} />
        </div>
      ) : (
        <PreviewBox content={state.content} onOpen={onOpen} />
      )}

      {/* Signals row — quality score circle + voice-match bars.
          Suppressed while generating so the skeleton reads cleanly. */}
      {!isGen && !isFailed && (
        <div className="flex items-center gap-[14px] px-[18px] pt-[14px] pb-[12px]">
          <div className="flex items-center gap-2">
            <span
              className="font-display flex h-[30px] w-[30px] items-center justify-center rounded-full text-[11px] font-bold tabular-nums"
              style={{ border: `2px solid ${qColor}`, color: qColor }}
            >
              {state.quality || "—"}
            </span>
            <span className="text-[11px] leading-tight font-medium text-[#8A93A3]">Quality</span>
          </div>
          <div className="ml-auto flex items-center gap-[7px]">
            <VoiceBars
              color={voice.color}
              muted={voice.muted}
              strength={voiceStrength(state.quality)}
            />
            <span className="text-[11px] font-semibold" style={{ color: voice.color }}>
              {voice.label}
            </span>
          </div>
        </div>
      )}

      {/* Action band — primary + optional secondary, side by side per ref. */}
      {!isGen && (
        <div className="flex items-stretch gap-2 px-4 pb-4">
          <ActionBand
            state={state.status}
            isReady={isReady}
            inReview={inReview}
            awaitingClient={awaitingClient}
            approved={approved}
            isScheduled={isScheduled}
            isPublished={isPublished}
            isFailed={isFailed}
            externalScheduler={state.externalScheduler ?? null}
            externalPostUrl={state.externalPostUrl ?? null}
            roleCanEdit={roleCanEdit}
            roleCanApprove={roleCanApprove}
            roleCanRequestReview={roleCanRequestReview}
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
      className="inline-flex flex-shrink-0 items-center gap-[6px] rounded-[7px] px-[9px] py-[5px] font-sans text-[11px] font-semibold"
      style={{ background: sm.bg, color: sm.color }}
    >
      <span className="block h-[6px] w-[6px] rounded-full" style={{ background: sm.color }} />
      {sm.label}
    </span>
  );
}

/** Alternate header pill for READY outputs the client has bounced back
 *  from the portal — same shape as StatusPill but styled to read as an
 *  attention signal instead of the neutral "Ready" peach. Distinguishes
 *  "just generated, needs review" from "client asked for changes". */
function RevisionRequestedPill() {
  return (
    <span
      className="inline-flex flex-shrink-0 items-center gap-[6px] rounded-[7px] px-[9px] py-[5px] font-sans text-[11px] font-semibold"
      style={{ background: "#FBEDEC", color: "#A03425" }}
    >
      <span className="block h-[6px] w-[6px] rounded-full" style={{ background: "#A03425" }} />
      Changes requested
    </span>
  );
}

/** Body preview box — bordered, subtle-tinted, click-to-open with a
 *  bottom fade and a floating "Open →" chip. */
function PreviewBox({ content, onOpen }: { content: string; onOpen?: () => void }) {
  const openable = Boolean(onOpen);
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
                onOpen?.();
              }
            }
          : undefined
      }
      className={`relative mx-4 flex-1 overflow-hidden rounded-[11px] border bg-[#FAFBFD] px-4 py-[14px] ${
        openable ? "cursor-pointer" : ""
      }`}
      style={{ borderColor: "#EEF1F6", minHeight: 128 }}
    >
      <div
        className="text-[13px] leading-[1.62] whitespace-pre-wrap text-[#3A4557]"
        style={{
          WebkitMaskImage: "linear-gradient(180deg,#000 62%,transparent 100%)",
          maskImage: "linear-gradient(180deg,#000 62%,transparent 100%)",
          maxHeight: 128,
          overflow: "hidden",
        }}
      >
        {content}
      </div>
      {openable && (
        <span
          className="absolute right-3 bottom-[10px] rounded-md bg-white px-2 py-[3px] font-mono text-[10.5px] font-medium"
          style={{
            color: "var(--color-accent)",
            boxShadow: "0 1px 4px rgba(26,42,74,0.1)",
          }}
        >
          Open →
        </span>
      )}
    </div>
  );
}

/** Three ascending bars — voice match indicator. Bars below `strength`
 *  render in a muted gray so a Developing voice reads as literally
 *  "one bar filled". */
function VoiceBars({ color, muted, strength }: { color: string; muted: string; strength: number }) {
  return (
    <span className="flex items-end gap-[2px]" aria-hidden>
      <span
        className="w-[3px] rounded-[1px]"
        style={{ height: 7, background: strength >= 1 ? color : muted }}
      />
      <span
        className="w-[3px] rounded-[1px]"
        style={{ height: 10, background: strength >= 2 ? color : muted }}
      />
      <span
        className="w-[3px] rounded-[1px]"
        style={{ height: 13, background: strength >= 3 ? color : muted }}
      />
    </span>
  );
}

function voiceStrength(q: number): 0 | 1 | 2 | 3 {
  if (q >= 85) return 3;
  if (q >= 72) return 2;
  if (q > 0) return 1;
  return 0;
}

function GeneratingPreview({ progress }: { progress: number }) {
  return (
    <div
      className="rounded-[11px] border bg-[#FAFBFD] px-4 py-[14px]"
      style={{ borderColor: "#EEF1F6", minHeight: 128 }}
    >
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
    <div
      className="rounded-lg border border-[#F0CCC9] bg-[#FBEDEC] px-3 py-2.5"
      style={{ minHeight: 128 }}
    >
      <div className="text-[12.5px] font-semibold text-[#C0392B]">Generation failed</div>
      {reason ? (
        <div className="text-muted mt-1 line-clamp-4 text-[11.5px] leading-[1.5]">{reason}</div>
      ) : null}
    </div>
  );
}

// ============================================================
// Action band — state-driven primary + optional secondary
// ============================================================

function ActionBand(p: {
  state: EpisodeStatus;
  isReady: boolean;
  inReview: boolean;
  awaitingClient: boolean;
  approved: boolean;
  isScheduled: boolean;
  isPublished: boolean;
  isFailed: boolean;
  externalScheduler: "BUFFER" | "MANUAL" | null;
  externalPostUrl: string | null;
  roleCanEdit: boolean;
  roleCanApprove: boolean;
  /** Editor-only surface — hides the "Request review" secondary button
   *  for OWNER/ADMIN/REVIEWER. */
  roleCanRequestReview: boolean;
  roleCanSchedule: boolean;
  onApprove: () => void;
  onRequestReview: () => void;
  onReject: () => void;
  onRetry: () => void;
  onOpen?: () => void;
}) {
  const clickWithStop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  if (p.isFailed) {
    return (
      <PrimaryButton
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
          className="flex flex-1 items-center justify-center gap-1.5 rounded-[9px] py-[10px] font-sans text-[13px] font-semibold transition-colors"
          style={{
            background: "#F4F6FA",
            color: "#1A2A4A",
            border: "1px solid #E4E8F0",
          }}
        >
          View post ↗
        </a>
      );
    }
    return (
      <div className="text-muted-2 flex-1 py-[10px] text-center text-[11.5px]">
        Published — no live link
      </div>
    );
  }

  if (p.isScheduled) {
    // Buffer-backed → view / waiting. Manual → mark published.
    const isManual = p.externalScheduler !== "BUFFER";
    if (isManual && p.roleCanSchedule) {
      return (
        <>
          <PrimaryButton label="Mark published" onClick={clickWithStop(() => p.onOpen?.())} />
          <SecondaryButton label="Unschedule" onClick={clickWithStop(() => p.onOpen?.())} />
        </>
      );
    }
    return (
      <>
        {p.externalPostUrl ? (
          <a
            href={p.externalPostUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={stop}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-[9px] py-[10px] font-sans text-[13px] font-semibold transition-colors"
            style={{
              borderColor: "#D1DAF0",
              background: "#F5F7FE",
              color: "#2A3F6B",
              border: "1px solid #D1DAF0",
            }}
          >
            View in Buffer ↗
          </a>
        ) : (
          <div className="text-muted-2 flex-1 py-[10px] text-center text-[11.5px]">
            Publishing via Buffer…
          </div>
        )}
        {p.roleCanSchedule && (
          <SecondaryButton label="Unschedule" onClick={clickWithStop(() => p.onOpen?.())} />
        )}
      </>
    );
  }

  if (p.approved) {
    return (
      <PrimaryButton
        label="Schedule"
        onClick={clickWithStop(() => p.onOpen?.())}
        disabled={!p.roleCanSchedule}
        tone="schedule"
      />
    );
  }

  if (p.awaitingClient) {
    // The client is the actor here — the agency team can't approve or
    // reject from this side. Show a passive waiting affordance instead
    // of an interactive button.
    return (
      <div className="text-muted-2 flex-1 py-[10px] text-center font-sans text-[11.5px]">
        Waiting on client approval
      </div>
    );
  }

  // Ready or in-review — both terminate with Approve. Secondary opens
  // the counterflow (Reject when in review, Request review when ready).
  // "Request review" is EDITOR-only — hidden for OWNER/ADMIN/REVIEWER,
  // who approve directly.
  return (
    <>
      <PrimaryButton
        label="Approve"
        onClick={clickWithStop(p.onApprove)}
        disabled={!p.roleCanApprove}
      />
      {p.inReview ? (
        <SecondaryButton
          label="Reject"
          onClick={clickWithStop(p.onReject)}
          disabled={!p.roleCanApprove}
        />
      ) : p.roleCanRequestReview ? (
        <SecondaryButton
          label="Request review"
          onClick={clickWithStop(p.onRequestReview)}
          disabled={!p.roleCanEdit}
        />
      ) : null}
    </>
  );
}

/** Primary CTA on the card's action band. Two tones:
 *  - `brand` (default) — accent navy for terminal review actions
 *    (Approve, Try again, Mark published).
 *  - `schedule` — purple #5D3FD3 for the post-approval Schedule step so
 *    the eye separates "finalize the copy" (navy) from "commit a
 *    publish time" (purple). Purple also pairs with the Scheduled
 *    status pill + the drawer's schedule confirmation button, so the
 *    color threads through the whole scheduling flow. */
function PrimaryButton({
  label,
  onClick,
  disabled = false,
  tone = "brand",
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  tone?: "brand" | "schedule";
}) {
  const style: CSSProperties =
    tone === "schedule"
      ? {
          background: "#5D3FD3",
          color: "#fff",
          border: "1px solid rgba(0,0,0,.06)",
          boxShadow: "0 1px 2px rgba(93,63,211,.22)",
        }
      : {
          background: "var(--color-accent)",
          color: "#fff",
          border: "1px solid rgba(0,0,0,.06)",
          boxShadow: "0 1px 2px rgba(58,91,160,.22)",
        };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex-1 rounded-[9px] py-[10px] font-sans text-[13px] font-semibold transition-[filter] hover:brightness-[0.94] disabled:cursor-not-allowed disabled:opacity-50"
      style={style}
    >
      {label}
    </button>
  );
}

function SecondaryButton({
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
      className="rounded-[9px] border bg-white px-[14px] py-[10px] font-sans text-[13px] font-medium whitespace-nowrap transition-colors hover:border-[#C3CBDA] hover:text-[#1A2A4A] disabled:cursor-not-allowed disabled:opacity-50"
      style={{ borderColor: "#DDE2EC", color: "#5A6473" }}
    >
      {label}
    </button>
  );
}
