"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Platform } from "@prisma/client";
import { MemberRole } from "@/lib/enums";
import { statusMeta, type EpisodeStatus } from "@/lib/sample-data/episode-status";
import type { PlatformKey, PlatformMeta } from "@/lib/sample-data/platforms";
import { qualityColor } from "@/lib/sample-data/quality";
import {
  listOutputVersionsAction,
  type OutputVersionSummary,
} from "@/app/(dashboard)/episodes/[id]/actions";
import {
  markOutputPublishedAction,
  scheduleOutputAction,
  unscheduleOutputAction,
} from "@/app/(dashboard)/schedule/actions";

/**
 * Phase 3.3 revamp — state-driven single-CTA card.
 *
 * The card's shape is dictated by `state.status`:
 *   generating → skeleton + progress, no menu, no action band
 *   failed     → error copy + [Try again]
 *   ready      → [Request review]? + [Approve →]
 *   review     → [Reject] + [Approve →]
 *   approved   → "Ready to publish" + [Schedule… →]  (expands into a
 *                two-choice schedule form on click)
 *   scheduled  → lifecycle line + [Unschedule] + [Mark published]? (manual only)
 *   published  → lifecycle line + [View post ↗]
 *
 * Secondary actions (Copy / Edit / Regenerate / version history) all live
 * in a `⋯` menu next to the status pill so the action band stays focused
 * on the single primary CTA for the current state. SCHEDULED + PUBLISHED
 * lock Edit + Regenerate — users must unschedule to modify content.
 */

// ============================================================
// Public types (kept identical to the prior card so `outputs-view.tsx`
// doesn't need to churn)
// ============================================================

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
  /** Phase 3.3 — populated when status is "scheduled" or "published". */
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

const EDIT_ROLES: MemberRole[] = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.EDITOR];
const APPROVE_ROLES: MemberRole[] = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.REVIEWER];
const SCHEDULE_ROLES: MemberRole[] = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.EDITOR];

const PLATFORM_KEY_TO_ENUM: Record<PlatformKey, Platform> = {
  x: Platform.TWITTER,
  li: Platform.LINKEDIN,
  ig: Platform.INSTAGRAM,
  tt: Platform.TIKTOK,
  notes: Platform.SHOW_NOTES,
  blog: Platform.BLOG,
  news: Platform.NEWSLETTER,
};
const BUFFER_PLATFORM_KEYS: PlatformKey[] = ["x", "li", "ig", "tt"];

// ============================================================
// Main component
// ============================================================

export function OutputCard({
  platform,
  hostName,
  state,
  episodeId,
  viewerRole,
  readOnly = false,
  bufferConnected = false,
  bufferConnectedPlatforms = [],
  actions,
}: {
  platform: PlatformMeta;
  hostName: string;
  state: OutputState;
  episodeId: string;
  viewerRole: MemberRole;
  readOnly?: boolean;
  bufferConnected?: boolean;
  bufferConnectedPlatforms?: Platform[];
  actions: OutputCardActions;
}) {
  const router = useRouter();
  const sm = statusMeta(state.status);
  const isGen = state.status === "generating";
  const isFailed = state.status === "failed";
  const isReady = state.status === "ready";
  const inReview = state.status === "review";
  const approved = state.status === "approved";
  const isScheduled = state.status === "scheduled";
  const isPublished = state.status === "published";
  const isLocked = isScheduled || isPublished;
  const canApproveStatus = isReady || inReview;

  // Role gating (mirrors server-side requireRole in `server/db/outputs.ts`).
  const roleCanEdit = !readOnly && EDIT_ROLES.includes(viewerRole) && !isLocked;
  const roleCanApprove = !readOnly && APPROVE_ROLES.includes(viewerRole) && !isLocked;
  const roleCanSchedule = !readOnly && SCHEDULE_ROLES.includes(viewerRole);
  const lockedReason = isPublished
    ? "Already published — this card is a record."
    : isScheduled
      ? "Scheduled — unschedule to modify."
      : null;
  const editBlockedReason = readOnly
    ? "Read-only impersonation — writes disabled."
    : (lockedReason ?? (EDIT_ROLES.includes(viewerRole) ? null : "Editors and above only."));
  const approveBlockedReason = readOnly
    ? "Read-only impersonation — writes disabled."
    : (lockedReason ?? (APPROVE_ROLES.includes(viewerRole) ? null : "Reviewers and above only."));

  // Version history — reset the switcher whenever `state.id` changes (a
  // regen produced a new current row). We do this in an effect because
  // the alternative "key the component on state.id" is enforced at the
  // caller in outputs-view.tsx — see the `<OutputCard key={o.key} ...>`
  // usage — so id-driven remounts already reset local state naturally.
  // The effect below is a belt-and-suspenders reset for the rare case
  // where state.id changes without a key change (SSE-driven mutation on
  // the same slot).
  const [viewing, setViewing] = useState<OutputVersionSummary | null>(null);
  const [versions, setVersions] = useState<OutputVersionSummary[] | null>(null);
  const [, startLoadVersions] = useTransition();
  const hasHistory = state.versionCount > 1;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset semantics
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
  const displayedContent = viewing?.content ?? state.content;
  const displayedVersion = viewing?.version ?? state.version;
  const viewingOlder = viewing !== null;
  const onPrevVersion = () => {
    if (!versions) return;
    const older = versions.find((v) => v.version === displayedVersion - 1);
    if (older) setViewing(older);
  };
  const onNextVersion = () => {
    if (!versions) return;
    if (displayedVersion + 1 >= state.version) {
      setViewing(null);
      return;
    }
    const newer = versions.find((v) => v.version === displayedVersion + 1);
    if (newer && !newer.isCurrent) setViewing(newer);
  };

  // Menu popover (secondary actions).
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // Scheduling — inline form + server actions.
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);
  const [scheduleFor, setScheduleFor] = useState(defaultScheduleFor());
  const platformEnum = PLATFORM_KEY_TO_ENUM[state.key as PlatformKey];
  const platformSupportsBuffer = BUFFER_PLATFORM_KEYS.includes(state.key as PlatformKey);
  const platformHasBufferChannel =
    bufferConnected && bufferConnectedPlatforms.includes(platformEnum);
  const bufferAvailable = platformSupportsBuffer && platformHasBufferChannel;
  // Track only the user's explicit override; the effective mode is derived
  // (Buffer when available, else manual). This dodges a
  // `react-hooks/set-state-in-effect` violation by not needing an effect
  // at all to keep the selection consistent with `bufferAvailable`.
  const [scheduleModeOverride, setScheduleModeOverride] = useState<"buffer" | "manual" | null>(
    null,
  );
  const scheduleMode: "buffer" | "manual" =
    scheduleModeOverride ?? (bufferAvailable ? "buffer" : "manual");
  const setScheduleMode = (v: "buffer" | "manual") => setScheduleModeOverride(v);
  const bufferHint = !platformSupportsBuffer
    ? "Buffer doesn't publish to this platform."
    : !bufferConnected
      ? "Connect Buffer in Settings → Integrations first."
      : !platformHasBufferChannel
        ? "No Buffer channel for this platform. Add one in Buffer, then hit “Refresh channels” in Settings."
        : "Buffer publishes at the scheduled time; Repodcast marks it Published once confirmed.";

  const [schedulePending, startSchedule] = useTransition();
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const submitSchedule = () => {
    setScheduleError(null);
    const iso = new Date(scheduleFor).toISOString();
    startSchedule(async () => {
      try {
        const res = await scheduleOutputAction({
          outputId: state.id,
          scheduledForIso: iso,
          mode: scheduleMode,
        });
        if (!res.ok) {
          setScheduleError(res.error);
          return;
        }
        setScheduleFormOpen(false);
        router.refresh();
      } catch (err) {
        setScheduleError(err instanceof Error ? err.message : "Couldn't schedule.");
      }
    });
  };
  const submitUnschedule = () => {
    setScheduleError(null);
    startSchedule(async () => {
      try {
        const res = await unscheduleOutputAction({ outputId: state.id });
        if (!res.ok) {
          setScheduleError(res.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setScheduleError(err instanceof Error ? err.message : "Couldn't unschedule.");
      }
    });
  };
  const submitMarkPublished = () => {
    setScheduleError(null);
    startSchedule(async () => {
      try {
        const res = await markOutputPublishedAction({ outputId: state.id });
        if (!res.ok) {
          setScheduleError(res.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setScheduleError(err instanceof Error ? err.message : "Couldn't mark published.");
      }
    });
  };

  // Silence unused-var lint — episodeId is currently used only for future
  // instrumentation (analytics per-output events). Keeping it in the API
  // surface avoids a churn on the caller when we wire that up.
  void episodeId;

  // ---- Container styling -------------------------------------------------
  // Neutral white base; small tints for scheduled (blue) + published
  // (green) to signal locked lifecycle states. No shadow on locked states
  // or approved — they've earned quiet. Ready/review/failed keep the
  // shadow so unfinished work draws the eye.
  const cardTint = isPublished
    ? "#F5FBF7"
    : isScheduled
      ? "#F7F9FE"
      : approved
        ? "#FDFEFC"
        : "#FFFFFF";
  const showShadow = !approved && !isLocked && !isGen;
  const rootStyle: CSSProperties = {
    background: cardTint,
    borderColor: sm.cardBorder,
  };

  return (
    <div
      className={`relative flex flex-col overflow-hidden rounded-2xl border ${showShadow ? "shadow-card" : ""}`}
      style={rootStyle}
    >
      {state.justApproved && (
        <div
          className="rounded-pill absolute top-3 right-[14px] z-[5] inline-flex items-center gap-[6px] bg-[#1E7A47] px-[11px] py-[6px] font-sans text-[11.5px] font-semibold text-white"
          style={{ boxShadow: "0 6px 18px rgba(30,122,71,.35)", animation: "pop .2s ease-out" }}
        >
          +1 voice sample · trained
        </div>
      )}

      {/* HEADER — platform badge, title, status pill, ⋯ menu */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
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
        <StatusPill sm={sm} />
        {!isGen && !state.editing && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label="More actions"
              onClick={() => setMenuOpen((v) => !v)}
              className="text-muted hover:text-ink hover:bg-canvas flex h-[28px] w-[28px] items-center justify-center rounded-lg transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <circle cx="4" cy="8" r="1.4" />
                <circle cx="8" cy="8" r="1.4" />
                <circle cx="12" cy="8" r="1.4" />
              </svg>
            </button>
            {menuOpen && (
              <MenuPanel
                onClose={() => setMenuOpen(false)}
                onCopy={() => {
                  actions.onCopy();
                  setMenuOpen(false);
                }}
                onEdit={
                  roleCanEdit
                    ? () => {
                        actions.onEdit();
                        setMenuOpen(false);
                      }
                    : null
                }
                editBlockedReason={editBlockedReason}
                onRegen={
                  roleCanEdit
                    ? () => {
                        actions.onToggleRegen();
                        setMenuOpen(false);
                      }
                    : null
                }
                justCopied={state.justCopied}
                hasHistory={hasHistory}
                displayedVersion={displayedVersion}
                totalVersions={state.versionCount}
                onPrev={onPrevVersion}
                onNext={onNextVersion}
                canPrev={displayedVersion > 1}
                canNext={displayedVersion < state.version}
              />
            )}
          </div>
        )}
      </div>

      {/* LIFECYCLE ROW — visible only on scheduled/published */}
      {isScheduled && (
        <LifecycleRow
          kind="scheduled"
          when={state.scheduledForIso}
          service={state.externalScheduler}
          externalUrl={state.externalPostUrl}
        />
      )}
      {isPublished && (
        <LifecycleRow
          kind="published"
          when={state.publishedAtIso}
          service={state.externalScheduler}
          externalUrl={state.externalPostUrl}
        />
      )}

      {/* VERSION SWITCHER — compact chip above content when history exists */}
      {hasHistory && !isGen && !state.editing && !isFailed && (
        <div className="mx-4 mb-2 flex items-center justify-between gap-2 rounded-md bg-[#F5F6F9] px-2.5 py-[5px]">
          <button
            type="button"
            aria-label="Older version"
            disabled={displayedVersion <= 1}
            onClick={onPrevVersion}
            className="text-muted hover:text-ink flex h-[20px] w-[20px] items-center justify-center rounded-md disabled:opacity-40"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 11 11"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            >
              <path d="M7 2.5L3.5 5.5L7 8.5" />
            </svg>
          </button>
          <span className="text-muted font-sans text-[11px] font-semibold">
            Version {displayedVersion} of {state.versionCount}
            {viewingOlder && (
              <span className="rounded-pill ml-[5px] bg-[#FBF1DE] px-[6px] py-[1px] text-[9.5px] font-semibold text-[#A06D12]">
                History
              </span>
            )}
          </span>
          <button
            type="button"
            aria-label="Newer version"
            disabled={displayedVersion >= state.version}
            onClick={onNextVersion}
            className="text-muted hover:text-ink flex h-[20px] w-[20px] items-center justify-center rounded-md disabled:opacity-40"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 11 11"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            >
              <path d="M4 2.5L7.5 5.5L4 8.5" />
            </svg>
          </button>
        </div>
      )}

      {/* CONTENT AREA — dispatches by state */}
      <div className="flex-1 px-4 pb-3">
        {isGen ? (
          <GeneratingView hostName={hostName} progress={state.progress} />
        ) : isFailed ? (
          <FailedView reason={state.failureReason ?? null} />
        ) : state.editing ? (
          <EditingView state={state} actions={actions} />
        ) : state.showRegen ? (
          <RegenView state={state} actions={actions} />
        ) : (
          <ContentView content={displayedContent} quality={state.quality} />
        )}
      </div>

      {/* ACTION BAND — state-driven, one primary CTA (plus contextual
          secondaries). Hidden on GENERATING and while EDITING/REGENERATING
          because those states have their own commit rows above. */}
      {!isGen && !state.editing && !state.showRegen && (
        <ActionBand
          state={state.status}
          isReady={isReady}
          inReview={inReview}
          approved={approved}
          isScheduled={isScheduled}
          isPublished={isPublished}
          isFailed={isFailed}
          scheduleFormOpen={scheduleFormOpen}
          externalScheduler={state.externalScheduler ?? null}
          externalPostUrl={state.externalPostUrl ?? null}
          scheduledForIso={state.scheduledForIso ?? null}
          roleCanEdit={roleCanEdit}
          roleCanApprove={roleCanApprove}
          roleCanSchedule={roleCanSchedule}
          canApproveStatus={canApproveStatus}
          editBlockedReason={editBlockedReason}
          approveBlockedReason={approveBlockedReason}
          onApprove={actions.onApprove}
          onRequestReview={actions.onRequestReview}
          onReject={actions.onReject}
          onRetry={actions.onRetry}
          onOpenSchedule={() => {
            setScheduleModeOverride(null);
            setScheduleFormOpen(true);
          }}
          onCancelSchedule={() => setScheduleFormOpen(false)}
          onSubmitSchedule={submitSchedule}
          onUnschedule={submitUnschedule}
          onMarkPublished={submitMarkPublished}
          scheduleFor={scheduleFor}
          setScheduleFor={setScheduleFor}
          scheduleMode={scheduleMode}
          setScheduleMode={setScheduleMode}
          bufferAvailable={bufferAvailable}
          bufferHint={bufferHint}
          schedulePending={schedulePending}
          scheduleError={scheduleError}
          viewingOlder={viewingOlder}
        />
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
      className="rounded-pill inline-flex flex-shrink-0 items-center gap-[6px] px-[10px] py-[3.5px] font-sans text-[11px] font-semibold"
      style={{ background: sm.bg, color: sm.color }}
    >
      <span className="block h-[6px] w-[6px] rounded-full" style={{ background: sm.color }} />
      {sm.label}
    </span>
  );
}

function LifecycleRow({
  kind,
  when,
  service,
  externalUrl,
}: {
  kind: "scheduled" | "published";
  when: string | null | undefined;
  service: "BUFFER" | "MANUAL" | null | undefined;
  externalUrl: string | null | undefined;
}) {
  const date = when ? new Date(when) : null;
  const label = date ? date.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—";
  const isPub = kind === "published";
  return (
    <div
      className="mx-4 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-[11.5px]"
      style={{
        background: isPub ? "#DBEDD9" : "#E8EEFA",
        color: isPub ? "#166534" : "#2A3550",
        border: `1px solid ${isPub ? "#BEDDBA" : "#D1DAF0"}`,
      }}
    >
      <span className="inline-flex items-center gap-[6px] font-semibold">
        {isPub ? (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2.5 6.2 5 8.5 9.5 3.5" />
          </svg>
        ) : (
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="6" cy="6" r="4.2" />
            <path d="M6 3.5V6l1.7 1" strokeLinecap="round" />
          </svg>
        )}
        {isPub ? "Published" : "Scheduled for"} {label}
      </span>
      {service ? (
        <span className="text-muted-2 font-mono text-[10.5px] tracking-[0.05em] uppercase">
          via {service}
        </span>
      ) : null}
      {externalUrl ? (
        <a
          href={externalUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="ml-auto text-[11.5px] font-semibold underline"
          style={{ color: isPub ? "#166534" : "#2A3550" }}
        >
          View post ↗
        </a>
      ) : null}
    </div>
  );
}

function ContentView({ content, quality }: { content: string; quality: number }) {
  const qc = qualityColor(quality);
  return (
    <>
      <div className="mb-[6px] max-h-[240px] overflow-y-auto pr-[6px] font-sans text-[13px] leading-[1.6] whitespace-pre-wrap text-[#39435A]">
        {content}
      </div>
      {quality > 0 && (
        <div className="mt-2 flex items-center gap-[6px]">
          <span
            className="rounded-md px-[8px] py-[2px] font-mono text-[10.5px] font-semibold"
            style={{ background: `${qc}18`, color: qc, border: `1px solid ${qc}30` }}
          >
            Quality {quality}
          </span>
        </div>
      )}
    </>
  );
}

function GeneratingView({ hostName, progress }: { hostName: string; progress: number }) {
  return (
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
            style={{
              width: `${Math.max(4, Math.min(100, progress))}%`,
              transition: "width .35s ease",
            }}
          />
        </div>
        <span className="text-muted-2 font-mono text-[10.5px] tabular-nums">
          {Math.round(progress)}%
        </span>
      </div>
    </div>
  );
}

function FailedView({ reason }: { reason: string | null }) {
  return (
    <div className="rounded-lg border border-[#F0CCC9] bg-[#FBEDEC] px-3 py-2">
      <div className="text-[12.5px] font-semibold text-[#C0392B]">Generation failed</div>
      {reason ? (
        <div className="text-muted mt-[3px] text-[12px] leading-[1.45]">{reason}</div>
      ) : (
        <div className="text-muted mt-[3px] text-[12px]">
          The pipeline errored before this output finished. No usage was billed.
        </div>
      )}
    </div>
  );
}

function EditingView({ state, actions }: { state: OutputState; actions: OutputCardActions }) {
  return (
    <>
      <textarea
        value={state.draft}
        onChange={(e) => actions.onDraftChange(e.target.value)}
        className="h-[188px] w-full resize-y rounded-[10px] px-3 py-[11px] font-sans text-[13px] leading-[1.55] text-[#2A3550] outline-none"
        style={{ border: "1px solid #C9D4E8", background: "#FBFCFE" }}
      />
      <div className="mt-[10px] flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={actions.onCancelEdit}
          className="border-border text-muted rounded-md border bg-white px-[14px] py-[7px] font-sans text-[12.5px] font-medium"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={actions.onSaveEdit}
          className="bg-accent rounded-md px-[14px] py-[7px] font-sans text-[12.5px] font-semibold text-white"
        >
          Save changes
        </button>
      </div>
    </>
  );
}

function RegenView({ state, actions }: { state: OutputState; actions: OutputCardActions }) {
  return (
    <div className="rounded-lg border border-[#C9D4E8] bg-[#F7F9FE] p-3">
      <div className="text-muted-2 mb-[7px] font-mono text-[10.5px] tracking-[0.05em] uppercase">
        Rewrite instruction
      </div>
      <textarea
        value={state.regenText}
        onChange={(e) => actions.onRegenTextChange(e.target.value)}
        placeholder="e.g. Shorter and punchier. Lead with the counterintuitive hook."
        className="h-[80px] w-full resize-none rounded-md px-2 py-[6px] font-sans text-[12.5px] leading-[1.5] text-[#2A3550] outline-none"
        style={{ border: "1px solid #C9D4E8", background: "#fff" }}
      />
      <div className="mt-[8px] flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={actions.onToggleRegen}
          className="text-muted hover:text-ink px-2 py-1 text-[12px]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={actions.onApplyRegen}
          className="bg-accent rounded-md px-3 py-[7px] font-sans text-[12.5px] font-semibold text-white"
        >
          Regenerate
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Menu popover
// ============================================================

function MenuPanel({
  onClose,
  onCopy,
  onEdit,
  editBlockedReason,
  onRegen,
  justCopied,
  hasHistory,
  displayedVersion,
  totalVersions,
  onPrev,
  onNext,
  canPrev,
  canNext,
}: {
  onClose: () => void;
  onCopy: () => void;
  onEdit: (() => void) | null;
  editBlockedReason: string | null;
  onRegen: (() => void) | null;
  justCopied: boolean;
  hasHistory: boolean;
  displayedVersion: number;
  totalVersions: number;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
}) {
  void onClose;
  return (
    <div
      className="border-border shadow-card absolute right-0 z-20 mt-1 w-[220px] rounded-xl border bg-white p-1.5"
      style={{ boxShadow: "0 10px 30px rgba(20,30,60,.12)" }}
    >
      <MenuItem onClick={onCopy} label={justCopied ? "Copied ✓" : "Copy content"} />
      <MenuItem
        onClick={onEdit}
        label="Edit content"
        disabled={!onEdit}
        title={onEdit ? undefined : (editBlockedReason ?? undefined)}
      />
      <MenuItem
        onClick={onRegen}
        label="Regenerate…"
        disabled={!onRegen}
        title={onRegen ? undefined : (editBlockedReason ?? undefined)}
      />
      {hasHistory && (
        <>
          <div className="my-1 border-t" style={{ borderColor: "rgba(0,0,0,.06)" }} />
          <div className="text-muted-2 px-2 pt-1 pb-0.5 font-mono text-[10px] tracking-[0.05em] uppercase">
            History
          </div>
          <div className="flex items-center justify-between px-2 py-1 text-[12px]">
            <button
              type="button"
              disabled={!canPrev}
              onClick={onPrev}
              className="text-muted hover:text-ink rounded px-1 disabled:opacity-40"
            >
              ← older
            </button>
            <span className="text-muted-2 font-mono text-[10.5px]">
              v{displayedVersion}/{totalVersions}
            </span>
            <button
              type="button"
              disabled={!canNext}
              onClick={onNext}
              className="text-muted hover:text-ink rounded px-1 disabled:opacity-40"
            >
              newer →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  disabled = false,
  title,
}: {
  label: string;
  onClick: (() => void) | null;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick?.()}
      disabled={disabled}
      title={title}
      className="text-ink hover:bg-canvas w-full rounded-md px-2.5 py-1.5 text-left font-sans text-[12.5px] disabled:cursor-not-allowed disabled:text-zinc-400"
    >
      {label}
    </button>
  );
}

// ============================================================
// Action band — the state-driven CTA row at the bottom of every card
// ============================================================

type ActionBandProps = {
  state: EpisodeStatus;
  isReady: boolean;
  inReview: boolean;
  approved: boolean;
  isScheduled: boolean;
  isPublished: boolean;
  isFailed: boolean;
  scheduleFormOpen: boolean;
  externalScheduler: "BUFFER" | "MANUAL" | null;
  externalPostUrl: string | null;
  scheduledForIso: string | null;
  roleCanEdit: boolean;
  roleCanApprove: boolean;
  roleCanSchedule: boolean;
  canApproveStatus: boolean;
  editBlockedReason: string | null;
  approveBlockedReason: string | null;
  onApprove: () => void;
  onRequestReview: () => void;
  onReject: () => void;
  onRetry: () => void;
  onOpenSchedule: () => void;
  onCancelSchedule: () => void;
  onSubmitSchedule: () => void;
  onUnschedule: () => void;
  onMarkPublished: () => void;
  scheduleFor: string;
  setScheduleFor: (v: string) => void;
  scheduleMode: "buffer" | "manual";
  setScheduleMode: (v: "buffer" | "manual") => void;
  bufferAvailable: boolean;
  bufferHint: string;
  schedulePending: boolean;
  scheduleError: string | null;
  viewingOlder: boolean;
};

function ActionBand(p: ActionBandProps) {
  const dividerStyle: CSSProperties = {
    borderTop: "1px solid rgba(0,0,0,.06)",
  };

  // --- Failed --------------------------------------------------------
  if (p.isFailed) {
    return (
      <div className="flex items-center justify-end gap-2 px-4 py-3" style={dividerStyle}>
        <button
          type="button"
          onClick={p.onRetry}
          disabled={!p.roleCanEdit || p.viewingOlder}
          title={p.editBlockedReason ?? undefined}
          className="bg-accent rounded-md px-3.5 py-[7px] font-sans text-[12.5px] font-semibold text-white disabled:opacity-50"
        >
          Try again
        </button>
      </div>
    );
  }

  // --- Published -----------------------------------------------------
  if (p.isPublished) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
        style={dividerStyle}
      >
        <span className="text-muted-2 text-[11.5px]">
          This card is a record of what was posted.
        </span>
        {p.externalPostUrl ? (
          <a
            href={p.externalPostUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent rounded-md px-3 py-[7px] font-sans text-[12.5px] font-semibold underline"
          >
            View post ↗
          </a>
        ) : (
          <span className="text-muted text-[11.5px]">Live URL not captured.</span>
        )}
      </div>
    );
  }

  // --- Scheduled -----------------------------------------------------
  if (p.isScheduled) {
    const canMarkManual = p.roleCanSchedule && p.externalScheduler !== "BUFFER";
    return (
      <div className="flex flex-col gap-2 px-4 py-3" style={dividerStyle}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-2 text-[11.5px]">
            {p.externalScheduler === "BUFFER"
              ? "Buffer will publish and Repodcast will sync automatically."
              : "You'll post this yourself — mark it published once it's live."}
          </span>
          <div className="flex items-center gap-2">
            {canMarkManual && (
              <button
                type="button"
                onClick={p.onMarkPublished}
                disabled={p.schedulePending}
                className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-[7px] font-sans text-[12.5px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
              >
                Mark published
              </button>
            )}
            {p.roleCanSchedule && (
              <button
                type="button"
                onClick={p.onUnschedule}
                disabled={p.schedulePending}
                className="border-border text-muted hover:text-ink rounded-md border bg-white px-3 py-[7px] font-sans text-[12.5px] font-semibold disabled:opacity-50"
              >
                Unschedule
              </button>
            )}
          </div>
        </div>
        {p.scheduleError && <div className="text-[11.5px] text-red-700">{p.scheduleError}</div>}
      </div>
    );
  }

  // --- Approved ------------------------------------------------------
  if (p.approved) {
    if (p.scheduleFormOpen) {
      // In-place schedule form. Replaces the CTA button with the fields.
      return (
        <div className="flex flex-col gap-3 px-4 py-3" style={dividerStyle}>
          <div className="text-muted-2 font-mono text-[10.5px] tracking-[0.05em] uppercase">
            Schedule this post
          </div>
          <label className="flex items-center gap-2 text-[12.5px]">
            <span className="text-muted-2 w-14 font-mono text-[10.5px] tracking-[0.05em] uppercase">
              When
            </span>
            <input
              type="datetime-local"
              value={p.scheduleFor}
              onChange={(e) => p.setScheduleFor(e.target.value)}
              className="border-border flex-1 rounded-md border px-2 py-1 text-[12.5px] outline-none"
            />
          </label>
          <div className="flex flex-col gap-1.5">
            <ScheduleChoice
              value="buffer"
              selected={p.scheduleMode}
              onSelect={p.setScheduleMode}
              disabled={!p.bufferAvailable}
              disabledReason={p.bufferAvailable ? null : p.bufferHint}
              title="Send via Buffer"
              body={
                p.bufferAvailable
                  ? "Buffer publishes at the scheduled time. Repodcast marks it Published once Buffer confirms."
                  : p.bufferHint
              }
            />
            <ScheduleChoice
              value="manual"
              selected={p.scheduleMode}
              onSelect={p.setScheduleMode}
              disabled={false}
              disabledReason={null}
              title="I'll post it myself"
              body="Repodcast holds the scheduled date as a reminder. Come back and click Mark published after you post it."
            />
          </div>
          {p.scheduleError && <div className="text-[11.5px] text-red-700">{p.scheduleError}</div>}
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={p.onCancelSchedule}
              className="text-muted hover:text-ink px-2 py-1 text-[12.5px]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={p.onSubmitSchedule}
              disabled={p.schedulePending}
              className="bg-accent rounded-md px-3 py-[7px] font-sans text-[12.5px] font-semibold text-white disabled:opacity-50"
            >
              {p.schedulePending ? "Scheduling…" : "Schedule"}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-between gap-2 px-4 py-3" style={dividerStyle}>
        <span className="text-muted-2 text-[11.5px]">Ready to publish.</span>
        <button
          type="button"
          onClick={p.onOpenSchedule}
          disabled={!p.roleCanSchedule || p.viewingOlder}
          title={p.roleCanSchedule ? undefined : "Only Editor, Admin, or Owner can schedule."}
          className="bg-accent rounded-md px-3.5 py-[7px] font-sans text-[12.5px] font-semibold text-white disabled:opacity-50"
        >
          Schedule… →
        </button>
      </div>
    );
  }

  // --- Ready or In-Review -------------------------------------------
  if (p.isReady || p.inReview) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3" style={dividerStyle}>
        {p.inReview ? (
          <button
            type="button"
            onClick={p.onReject}
            disabled={!p.roleCanApprove || p.viewingOlder}
            title={p.approveBlockedReason ?? undefined}
            className="rounded-md border border-[#E6D9B8] bg-white px-3 py-[7px] font-sans text-[12.5px] font-semibold text-[#A06D12] disabled:opacity-50"
          >
            Reject
          </button>
        ) : (
          <button
            type="button"
            onClick={p.onRequestReview}
            disabled={!p.roleCanEdit || p.viewingOlder}
            title={p.editBlockedReason ?? undefined}
            className="border-accent-border text-accent hover:bg-accent-soft rounded-md border bg-white px-3 py-[7px] font-sans text-[12.5px] font-semibold disabled:opacity-50"
          >
            Request review
          </button>
        )}
        <button
          type="button"
          onClick={p.onApprove}
          disabled={!p.roleCanApprove || p.viewingOlder || !p.canApproveStatus}
          title={p.approveBlockedReason ?? undefined}
          className="bg-accent rounded-md px-3.5 py-[7px] font-sans text-[12.5px] font-semibold text-white disabled:opacity-50"
          style={{ boxShadow: "0 1px 2px rgba(26,42,74,.2)" }}
        >
          ✓ Approve →
        </button>
      </div>
    );
  }

  return null;
}

function ScheduleChoice({
  value,
  selected,
  onSelect,
  disabled,
  disabledReason,
  title,
  body,
}: {
  value: "buffer" | "manual";
  selected: "buffer" | "manual";
  onSelect: (v: "buffer" | "manual") => void;
  disabled: boolean;
  disabledReason: string | null;
  title: string;
  body: string;
}) {
  const isSelected = selected === value && !disabled;
  return (
    <label
      className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 transition-colors ${
        disabled
          ? "cursor-not-allowed border-zinc-200 bg-zinc-50 opacity-60"
          : isSelected
            ? "border-accent-border bg-accent-soft"
            : "border-border hover:bg-zinc-50"
      }`}
      title={disabled && disabledReason ? disabledReason : undefined}
    >
      <input
        type="radio"
        className="mt-[3px]"
        checked={isSelected}
        disabled={disabled}
        onChange={() => !disabled && onSelect(value)}
      />
      <div className="flex-1">
        <div className="text-ink text-[12.5px] font-semibold">{title}</div>
        <div className="text-muted mt-0.5 text-[11.5px] leading-[1.5]">{body}</div>
      </div>
    </label>
  );
}

// ============================================================
// Helpers
// ============================================================

function defaultScheduleFor(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(9, 0, 0, 0);
  return d.toISOString().slice(0, 16);
}
