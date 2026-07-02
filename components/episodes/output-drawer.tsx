"use client";

import { useEffect, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Platform } from "@prisma/client";
import { MemberRole } from "@/lib/enums";
import { statusMeta, type EpisodeStatus } from "@/lib/sample-data/episode-status";
import type { PlatformKey, PlatformMeta } from "@/lib/sample-data/platforms";
import {
  listOutputVersionsAction,
  type OutputVersionSummary,
} from "@/app/(dashboard)/episodes/[id]/actions";
import {
  markOutputPublishedAction,
  scheduleOutputAction,
  unscheduleOutputAction,
} from "@/app/(dashboard)/schedule/actions";
import type { OutputCardActions, OutputState } from "./output-card";

/**
 * Details drawer (see ref/card2.png). Opens on card click. Owns every
 * secondary action the compact card hides: full content, edit / regen
 * forms, schedule form, unschedule, mark-published, version history,
 * copy-to-clipboard.
 *
 * Layout: right-anchored sliding sheet, ~460px wide on desktop, full
 * width on mobile. Sticky header + sticky footer, scrolling body.
 */

const APPROVE_ROLES: MemberRole[] = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.REVIEWER];
const EDIT_ROLES: MemberRole[] = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.EDITOR];
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

export function OutputDrawer({
  platform,
  state,
  episodeId,
  viewerRole,
  readOnly = false,
  bufferConnected = false,
  bufferConnectedPlatforms = [],
  actions,
  onClose,
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
  onClose: () => void;
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

  const roleCanEdit = !readOnly && EDIT_ROLES.includes(viewerRole) && !isLocked;
  const roleCanApprove = !readOnly && APPROVE_ROLES.includes(viewerRole) && !isLocked;
  const roleCanSchedule = !readOnly && SCHEDULE_ROLES.includes(viewerRole);

  // Escape key + backdrop click close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Version history — same effect + switcher pattern as the older card.
  const [viewing, setViewing] = useState<OutputVersionSummary | null>(null);
  const [versions, setVersions] = useState<OutputVersionSummary[] | null>(null);
  const [, startLoadVersions] = useTransition();
  const hasHistory = state.versionCount > 1;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset semantics on id change
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

  // Schedule form state — same pattern as prior card, hoisted here.
  const [scheduleFor, setScheduleFor] = useState(defaultScheduleFor());
  const platformEnum = PLATFORM_KEY_TO_ENUM[state.key as PlatformKey];
  const platformSupportsBuffer = BUFFER_PLATFORM_KEYS.includes(state.key as PlatformKey);
  const platformHasBufferChannel =
    bufferConnected && bufferConnectedPlatforms.includes(platformEnum);
  const bufferAvailable = platformSupportsBuffer && platformHasBufferChannel;
  const [scheduleModeOverride, setScheduleModeOverride] = useState<"buffer" | "manual" | null>(
    null,
  );
  const scheduleMode: "buffer" | "manual" =
    scheduleModeOverride ?? (bufferAvailable ? "buffer" : "manual");
  const bufferHint = !platformSupportsBuffer
    ? "Buffer doesn't publish to this platform."
    : !bufferConnected
      ? "Connect Buffer in Settings → Integrations first."
      : !platformHasBufferChannel
        ? "No Buffer channel for this platform. Add one in Buffer, then hit “Refresh channels” in Settings."
        : "Buffer publishes at the scheduled time; Repodcast marks it Published once Buffer confirms.";

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submitSchedule = () => {
    setError(null);
    const iso = new Date(scheduleFor).toISOString();
    startTransition(async () => {
      try {
        const res = await scheduleOutputAction({
          outputId: state.id,
          scheduledForIso: iso,
          mode: scheduleMode,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.refresh();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't schedule.");
      }
    });
  };
  const submitUnschedule = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await unscheduleOutputAction({ outputId: state.id });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't unschedule.");
      }
    });
  };
  const submitMarkPublished = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await markOutputPublishedAction({ outputId: state.id });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't mark published.");
      }
    });
  };

  const scheduledDate = state.scheduledForIso ? new Date(state.scheduledForIso) : null;
  const publishedDate = state.publishedAtIso ? new Date(state.publishedAtIso) : null;
  const wordCount = countWords(displayedContent);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50"
      style={{ background: "rgba(20,30,60,.32)" }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${platform.fullName} output`}
        className="absolute top-0 right-0 flex h-full w-full max-w-[480px] flex-col bg-white shadow-2xl"
        style={{ animation: "drawer-slide .18s ease-out" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-zinc-100 px-5 py-4">
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
            <div className="font-display text-ink truncate text-[15px] leading-tight font-semibold">
              {platform.fullName}
            </div>
            <div className="text-muted-2 mt-0.5 text-[11px]">{state.meta}</div>
          </div>
          <StatusPillLarge sm={sm} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted hover:text-ink hover:bg-canvas flex h-[30px] w-[30px] items-center justify-center rounded-md transition-colors"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            >
              <path d="M3 3 11 11M11 3 3 11" />
            </svg>
          </button>
        </div>

        {/* Metadata strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-zinc-100 px-5 py-2.5 text-[11px] text-zinc-500">
          {isPublished && publishedDate ? (
            <MetaBadge tone="ok" label={`Published ${formatShortDateTime(publishedDate)}`} />
          ) : isScheduled && scheduledDate ? (
            <MetaBadge tone="info" label={`Scheduled ${formatShortDateTime(scheduledDate)}`} />
          ) : (
            <span className="font-mono">{wordCount} words</span>
          )}
          {state.quality > 0 && <span className="font-mono">Quality {state.quality}</span>}
          {isScheduled || isPublished ? (
            state.externalScheduler === "BUFFER" ? (
              <span className="font-mono">via Buffer</span>
            ) : state.externalScheduler === "MANUAL" ? (
              <span className="font-mono">manual</span>
            ) : null
          ) : null}
        </div>

        {/* Version history */}
        {hasHistory && !state.editing && (
          <div className="flex items-center justify-between gap-2 border-b border-zinc-100 bg-[#FBFCFE] px-5 py-2 text-[11.5px]">
            <button
              type="button"
              disabled={displayedVersion <= 1}
              onClick={() => {
                if (!versions) return;
                const older = versions.find((v) => v.version === displayedVersion - 1);
                if (older) setViewing(older);
              }}
              className="text-muted hover:text-ink rounded px-1 disabled:opacity-40"
            >
              ← older
            </button>
            <span className="text-muted font-mono text-[11px]">
              Version {displayedVersion} / {state.versionCount}
              {viewingOlder ? (
                <span className="ml-1 rounded bg-[#FBF1DE] px-1.5 py-0.5 text-[9.5px] font-semibold text-[#A06D12]">
                  history
                </span>
              ) : null}
            </span>
            <button
              type="button"
              disabled={displayedVersion >= state.version}
              onClick={() => {
                if (!versions) return;
                if (displayedVersion + 1 >= state.version) {
                  setViewing(null);
                  return;
                }
                const newer = versions.find((v) => v.version === displayedVersion + 1);
                if (newer && !newer.isCurrent) setViewing(newer);
              }}
              className="text-muted hover:text-ink rounded px-1 disabled:opacity-40"
            >
              newer →
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isGen ? (
            <GeneratingBody progress={state.progress} />
          ) : isFailed ? (
            <FailedBody reason={state.failureReason ?? null} />
          ) : state.editing ? (
            <EditingBody state={state} actions={actions} />
          ) : state.showRegen ? (
            <RegenBody state={state} actions={actions} />
          ) : (
            <div className="text-ink text-[13.5px] leading-[1.65] whitespace-pre-wrap">
              {displayedContent}
            </div>
          )}

          {/* Schedule form — only when Approved and not editing/regenerating */}
          {approved && !state.editing && !state.showRegen && (
            <div className="mt-6 border-t border-zinc-100 pt-5">
              <div className="text-ink text-[13.5px] font-semibold">Schedule this post</div>
              <label className="mt-3 flex items-center gap-2 text-[12.5px]">
                <span className="text-muted-2 w-12 font-mono text-[10.5px] tracking-[0.05em] uppercase">
                  When
                </span>
                <input
                  type="datetime-local"
                  value={scheduleFor}
                  onChange={(e) => setScheduleFor(e.target.value)}
                  className="border-border flex-1 rounded-md border px-2 py-1.5 text-[12.5px] outline-none"
                />
              </label>
              <div className="mt-3 flex flex-col gap-2">
                <ScheduleChoice
                  value="buffer"
                  selected={scheduleMode}
                  onSelect={setScheduleModeOverride}
                  disabled={!bufferAvailable}
                  disabledReason={bufferAvailable ? null : bufferHint}
                  title="Send via Buffer"
                  body={
                    bufferAvailable
                      ? "Publishes at the scheduled time. Marked Published once Buffer confirms."
                      : bufferHint
                  }
                />
                <ScheduleChoice
                  value="manual"
                  selected={scheduleMode}
                  onSelect={setScheduleModeOverride}
                  disabled={false}
                  disabledReason={null}
                  title="I'll post it myself"
                  body="Holds the date as a reminder. Come back and mark it published after you post."
                />
              </div>
            </div>
          )}
        </div>

        {/* Sticky footer — state-driven actions */}
        <div
          className="border-t border-zinc-100 bg-white px-5 py-3.5"
          style={{ boxShadow: "0 -1px 0 rgba(20,30,60,.02)" }}
        >
          {error ? <div className="mb-2 text-[11.5px] text-red-700">{error}</div> : null}

          {isGen ? (
            <div className="text-muted-2 text-center text-[11.5px]">
              Generating — actions unlock when the model returns.
            </div>
          ) : isFailed ? (
            <FooterRow
              onCancel={onClose}
              primary={{
                label: "Try again",
                tone: "brand",
                onClick: actions.onRetry,
                disabled: !roleCanEdit,
              }}
            />
          ) : state.editing ? (
            <FooterRow
              onCancel={actions.onCancelEdit}
              cancelLabel="Cancel edit"
              primary={{
                label: "Save changes",
                tone: "brand",
                onClick: actions.onSaveEdit,
              }}
            />
          ) : state.showRegen ? (
            <FooterRow
              onCancel={actions.onToggleRegen}
              cancelLabel="Cancel"
              primary={{
                label: "Regenerate",
                tone: "brand",
                onClick: actions.onApplyRegen,
              }}
            />
          ) : approved ? (
            <FooterRow
              onCancel={onClose}
              secondaryActions={[
                {
                  label: "Edit",
                  onClick: actions.onEdit,
                  disabled: !roleCanEdit,
                },
                {
                  label: "Regenerate",
                  onClick: actions.onToggleRegen,
                  disabled: !roleCanEdit,
                },
              ]}
              primary={{
                label: pending ? "Scheduling…" : "Confirm schedule",
                tone: "brand",
                onClick: submitSchedule,
                disabled: pending || !roleCanSchedule,
              }}
            />
          ) : isScheduled ? (
            <FooterRow
              onCancel={onClose}
              secondaryActions={
                roleCanSchedule
                  ? [{ label: "Unschedule", onClick: submitUnschedule, disabled: pending }]
                  : []
              }
              primary={
                state.externalScheduler !== "BUFFER" && roleCanSchedule
                  ? {
                      label: pending ? "Marking…" : "Mark published",
                      tone: "success",
                      onClick: submitMarkPublished,
                      disabled: pending,
                    }
                  : undefined
              }
            />
          ) : isPublished ? (
            <FooterRow
              onCancel={onClose}
              primary={
                state.externalPostUrl
                  ? {
                      label: "View post ↗",
                      tone: "success",
                      onClick: () => window.open(state.externalPostUrl!, "_blank", "noopener"),
                    }
                  : undefined
              }
            />
          ) : (
            /* ready or review */
            <FooterRow
              onCancel={onClose}
              secondaryActions={[
                {
                  label: "Edit",
                  onClick: actions.onEdit,
                  disabled: !roleCanEdit || viewingOlder,
                },
                {
                  label: "Regenerate",
                  onClick: actions.onToggleRegen,
                  disabled: !roleCanEdit || viewingOlder,
                },
                {
                  label: "Copy",
                  onClick: actions.onCopy,
                },
                inReview
                  ? {
                      label: "Reject",
                      onClick: actions.onReject,
                      disabled: !roleCanApprove,
                    }
                  : {
                      label: "Request review",
                      onClick: actions.onRequestReview,
                      disabled: !roleCanEdit,
                    },
              ]}
              primary={{
                label: "Approve",
                tone: "success",
                onClick: actions.onApprove,
                disabled: !roleCanApprove || viewingOlder,
              }}
            />
          )}
        </div>
      </aside>

      {/* Inline animation keyframes — self-contained so we don't depend
          on a global stylesheet update. */}
      <style>{`
        @keyframes drawer-slide {
          from { transform: translateX(24px); opacity: 0.6; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ============================================================
// Sub-views
// ============================================================

function StatusPillLarge({ sm }: { sm: ReturnType<typeof statusMeta> }) {
  return (
    <span
      className="rounded-pill inline-flex flex-shrink-0 items-center gap-[6px] px-[10px] py-[3.5px] font-sans text-[11.5px] font-semibold"
      style={{ background: sm.bg, color: sm.color }}
    >
      <span className="block h-[6px] w-[6px] rounded-full" style={{ background: sm.color }} />
      {sm.label}
    </span>
  );
}

function MetaBadge({ tone, label }: { tone: "ok" | "info"; label: string }) {
  const style: CSSProperties =
    tone === "ok"
      ? { background: "#DCF0E5", color: "#166534", border: "1px solid #BEDDBA" }
      : { background: "#E8EEFA", color: "#2A3550", border: "1px solid #D1DAF0" };
  return (
    <span className="rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold" style={style}>
      {label}
    </span>
  );
}

function GeneratingBody({ progress }: { progress: number }) {
  return (
    <div>
      <div className="mb-4 flex flex-col gap-[10px]">
        {[96, 90, 82, 74, 68, 58].map((w, i) => (
          <div
            key={i}
            className="bg-accent-soft h-[10px] rounded-[5px]"
            style={{
              width: `${w}%`,
              animation: "shimmer 1.2s ease-in-out infinite",
              animationDelay: `${i * 0.08}s`,
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-3">
        <div className="h-[6px] flex-1 overflow-hidden rounded-md bg-[#EEF1F6]">
          <div
            className="bg-accent h-full rounded-md"
            style={{
              width: `${Math.max(4, Math.min(100, progress))}%`,
              transition: "width .35s ease",
            }}
          />
        </div>
        <span className="text-muted-2 font-mono text-[11px] tabular-nums">
          {Math.round(progress)}%
        </span>
      </div>
    </div>
  );
}

function FailedBody({ reason }: { reason: string | null }) {
  return (
    <div className="rounded-lg border border-[#F0CCC9] bg-[#FBEDEC] px-3 py-2.5">
      <div className="text-[13px] font-semibold text-[#C0392B]">Generation failed</div>
      {reason ? (
        <div className="text-muted mt-1 text-[12.5px] leading-[1.5]">{reason}</div>
      ) : (
        <div className="text-muted mt-1 text-[12.5px]">
          The pipeline errored before this output finished. No usage was billed.
        </div>
      )}
    </div>
  );
}

function EditingBody({ state, actions }: { state: OutputState; actions: OutputCardActions }) {
  return (
    <textarea
      value={state.draft}
      onChange={(e) => actions.onDraftChange(e.target.value)}
      className="h-[360px] w-full resize-y rounded-[10px] px-3 py-3 font-sans text-[13.5px] leading-[1.6] text-[#2A3550] outline-none"
      style={{ border: "1px solid #C9D4E8", background: "#FBFCFE" }}
    />
  );
}

function RegenBody({ state, actions }: { state: OutputState; actions: OutputCardActions }) {
  return (
    <div className="rounded-lg border border-[#C9D4E8] bg-[#F7F9FE] p-3.5">
      <div className="text-muted-2 mb-2 font-mono text-[10.5px] tracking-[0.05em] uppercase">
        Rewrite instruction
      </div>
      <textarea
        value={state.regenText}
        onChange={(e) => actions.onRegenTextChange(e.target.value)}
        placeholder="e.g. Shorter and punchier. Lead with the counterintuitive hook."
        className="h-[120px] w-full resize-none rounded-md px-2.5 py-2 font-sans text-[13px] leading-[1.5] text-[#2A3550] outline-none"
        style={{ border: "1px solid #C9D4E8", background: "#fff" }}
      />
    </div>
  );
}

// ============================================================
// Schedule form
// ============================================================

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
      className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors ${
        disabled
          ? "cursor-not-allowed border-zinc-200 bg-zinc-50 opacity-60"
          : isSelected
            ? "border-[color:var(--color-accent-border)] bg-[color:var(--color-accent-soft)]"
            : "border-zinc-200 hover:bg-zinc-50"
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
        <div className="text-ink text-[13px] font-semibold">{title}</div>
        <div className="text-muted mt-0.5 text-[11.5px] leading-[1.5]">{body}</div>
      </div>
    </label>
  );
}

// ============================================================
// Footer row
// ============================================================

type FooterButton = {
  label: string;
  onClick: () => void;
  tone?: "success" | "brand" | "danger";
  disabled?: boolean;
};

function FooterRow({
  onCancel,
  cancelLabel = "Cancel",
  secondaryActions = [],
  primary,
}: {
  onCancel: () => void;
  cancelLabel?: string;
  secondaryActions?: FooterButton[];
  primary?: FooterButton;
}) {
  return (
    <div className="flex flex-col gap-2">
      {secondaryActions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {secondaryActions.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={s.onClick}
              disabled={s.disabled}
              className="text-muted hover:text-ink hover:bg-canvas rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 font-sans text-[11.5px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {s.label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-muted hover:text-ink px-2 py-1.5 text-[12.5px]"
        >
          {cancelLabel}
        </button>
        {primary ? <PrimaryFooterButton {...primary} /> : null}
      </div>
    </div>
  );
}

function PrimaryFooterButton({ label, onClick, tone = "brand", disabled = false }: FooterButton) {
  // Same tone palette as the card's PrimaryButton — the drawer footer
  // should feel like a continuation of the tile that opened it.
  //   success → soft mint outlined (Approve — matches the approved
  //             status-pill palette so CTA + resulting pill share a
  //             visual family)
  //   brand   → app accent navy `--color-accent` (#3A5BA0) with white
  //             text — the app's primary button. Used for Confirm
  //             schedule / Save / Regenerate / Try again.
  //   danger  → red (reserved for destructive UX; not used from this
  //             file today)
  const toneStyle: Record<"success" | "brand" | "danger", CSSProperties> = {
    success: {
      background: "#E7F4EC",
      color: "#1E7A47",
      border: "1px solid #CFE8DA",
      boxShadow: "none",
    },
    brand: {
      background: "var(--color-accent)",
      color: "#fff",
      border: "1px solid rgba(0,0,0,.06)",
      boxShadow: "0 1px 2px rgba(58,91,160,.22)",
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
      className="rounded-md px-4 py-2 font-sans text-[12.5px] font-semibold transition-[filter] hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-50"
      style={toneStyle[tone]}
    >
      {label}
    </button>
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

function formatShortDateTime(d: Date): string {
  const date = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const time = d.toISOString().slice(11, 16);
  return `${date}, ${time} UTC`;
}

function countWords(s: string): number {
  const trimmed = s.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}
