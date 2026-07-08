"use client";

import { useEffect, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Platform } from "@prisma/client";
import { MemberRole } from "@/lib/enums";
import { statusMeta, type EpisodeStatus } from "@/lib/sample-data/episode-status";
import type { PlatformKey, PlatformMeta } from "@/lib/sample-data/platforms";
import {
  listOutputVersionsAction,
  markOutputFeedbackReadAction,
} from "@/app/(dashboard)/episodes/[id]/actions";
// Type-only import kept in a separate `import type` statement pointing at
// the plain types module (not the `"use server"` actions file). Prevents
// production Turbopack builds from walking `actions.ts` → `server/db/*`
// while resolving the type in the client component's bundle.
import type { OutputVersionSummary } from "@/app/(dashboard)/episodes/[id]/types";
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
/** Mirrors `REQUEST_REVIEW_ROLES` in `output-card.tsx` + `server/db/outputs.ts`
 *  — editor-only surface. */
const REQUEST_REVIEW_ROLES: MemberRole[] = [MemberRole.EDITOR];

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
  clientValidationMode = "INTERNAL",
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
  clientValidationMode?: "INTERNAL" | "CLIENT";
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
  const awaitingClient = state.status === "awaiting-client";
  const approved = state.status === "approved";
  const isScheduled = state.status === "scheduled";
  const isPublished = state.status === "published";
  const isLocked = isScheduled || isPublished;
  const clientApproved = Boolean(state.clientApprovedAtIso);

  // Post-approval edit rules — see `canEditOutput` in `server/db/outputs.ts`
  // and the mirror in `output-card.tsx`.
  const roleCanEdit = (() => {
    if (readOnly || isLocked || clientApproved || awaitingClient) return false;
    if (approved) {
      if (clientValidationMode === "CLIENT") return false;
      return viewerRole === MemberRole.OWNER;
    }
    if (isReady || inReview) return EDIT_ROLES.includes(viewerRole);
    return false;
  })();
  const roleCanApprove =
    !readOnly && APPROVE_ROLES.includes(viewerRole) && !isLocked && !awaitingClient;
  const roleCanRequestReview =
    !readOnly && REQUEST_REVIEW_ROLES.includes(viewerRole) && !isLocked && !awaitingClient;
  const roleCanSchedule = !readOnly && SCHEDULE_ROLES.includes(viewerRole);
  // Recall is authorised for the same roles that could approve + send-
  // to-client (OWNER/ADMIN/REVIEWER). Only meaningful while the row is
  // actually in the client's portal queue, so gate on `awaitingClient`.
  // Deliberately separate from `roleCanApprove` because that one is
  // false under AWAITING (by design — no re-approve while in portal).
  const roleCanRecall =
    !readOnly && APPROVE_ROLES.includes(viewerRole) && awaitingClient && !clientApproved;

  // Escape key + backdrop click close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Auto-mark portal feedback as read the moment the operator opens
  // the drawer on a row the client bounced back. Fire-and-forget: the
  // action self-swallows errors and no-ops server-side when there's
  // nothing to mark, so we don't need to await or handle failures
  // here. Gated on `clientRevisionRequestedAtIso` so we don't touch
  // the DB for every drawer open — only the flagged rows.
  useEffect(() => {
    if (!state.clientRevisionRequestedAtIso) return;
    void markOutputFeedbackReadAction({ outputId: state.id }).catch((err) => {
      console.error("markOutputFeedbackReadAction failed", err);
    });
    // We only want this on drawer-open per output, not on every state
    // change while it's open — the id-scoped dep captures that.
  }, [state.id, state.clientRevisionRequestedAtIso]);

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
  const displayedQuality = viewing ? (viewing.quality ?? 0) : state.quality;
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
          // `stale_state` = the row already progressed past SCHEDULED
          // (Buffer confirmed publish while this tab still showed the
          // Unschedule button). Refresh so the prop-sync effect in
          // OutputsView pulls the current status, and close the drawer —
          // the fresh render will show the PUBLISHED pill and drop the
          // Unschedule affordance.
          if (res.errorCode === "stale_state") {
            router.refresh();
            onClose();
            return;
          }
          setError(res.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't unschedule.");
      }
    });
  };
  // Optional post URL captured on the MANUAL "Mark published" branch —
  // the operator pastes the link they just published to (Twitter,
  // LinkedIn, etc.), which populates `externalPostUrl` on the row so the
  // "View post ↗" primary appears afterwards. Cleared on drawer close by
  // unmount; no need to reset on submit since the drawer re-renders in
  // the PUBLISHED state right after.
  const [markPublishedUrl, setMarkPublishedUrl] = useState("");
  const [markPublishedUrlError, setMarkPublishedUrlError] = useState<string | null>(null);
  const submitMarkPublished = () => {
    setError(null);
    setMarkPublishedUrlError(null);
    const trimmedUrl = markPublishedUrl.trim();
    if (trimmedUrl.length > 0) {
      // The server action's zod schema requires a valid http(s) URL. Guard
      // client-side so the user gets an inline hint instead of the
      // generic ValidationError bubbling up.
      try {
        const parsed = new URL(trimmedUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("must be http or https");
        }
      } catch {
        setMarkPublishedUrlError("Enter a full URL starting with https:// (or leave blank).");
        return;
      }
    }
    startTransition(async () => {
      try {
        const res = await markOutputPublishedAction({
          outputId: state.id,
          externalPostUrl: trimmedUrl.length > 0 ? trimmedUrl : undefined,
        });
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
        className="absolute top-0 right-0 flex h-full w-full max-w-[500px] flex-col bg-white shadow-[-8px_0_32px_-8px_rgba(20,30,60,0.18)]"
        style={{ animation: "drawer-slide .18s ease-out" }}
      >
        {/* Header — badge tile + platform / meta stack + status + close.
            Slightly taller than the card header so the pill has room to
            breathe next to the close button. */}
        <div className="flex items-center gap-[12px] border-b border-zinc-100 px-6 py-[18px]">
          <div
            className="font-display flex items-center justify-center rounded-[10px] text-[14px] font-bold"
            style={{
              width: 40,
              height: 40,
              flexShrink: 0,
              background: platform.badgeBg,
              color: platform.badgeColor,
              border: `1px solid ${platform.badgeBorder}`,
            }}
          >
            {platform.badge}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-ink truncate text-[15.5px] leading-tight font-semibold tracking-[-0.01em]">
              {platform.fullName}
            </div>
            <div className="text-muted-2 mt-[3px] truncate font-mono text-[10.5px] tracking-[0.05em] uppercase">
              {state.meta}
            </div>
          </div>
          {isReady && state.clientRevisionRequestedAtIso ? (
            <RevisionRequestedPillLarge />
          ) : (
            <StatusPillLarge sm={sm} />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted hover:text-ink hover:bg-canvas ml-1 flex h-[32px] w-[32px] flex-shrink-0 items-center justify-center rounded-md transition-colors"
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

        {/* Client revision-request panel — the specific reason this row
            is flagged. Rendered above the signal strip so a reviewer
            landing from the Clients-nav badge sees the ask first, then
            the quality context, then the content. Only shown while the
            row is actionable (READY) — the flag clears the moment the
            agency approves / requests review / regens. */}
        {isReady && state.clientRevisionRequestedAtIso ? (
          <ClientRevisionPanel
            requestedAtIso={state.clientRevisionRequestedAtIso}
            note={state.clientRevisionNote ?? null}
          />
        ) : null}

        {/* Signal strip — Quality score + Voice match, two boxes per ref.
            Hidden while generating so the skeleton reads cleanly. */}
        {!isGen && (
          <div className="grid grid-cols-2 gap-[12px] border-b border-zinc-100 bg-[#FAFBFD] px-6 py-[18px]">
            <SignalCard label="Quality score">
              <QualityCircle score={displayedQuality} />
              <span className="text-[12.5px] leading-[1.4] font-medium text-[#5A6473]">
                {qualityNoteFor(displayedQuality)}
              </span>
            </SignalCard>
            <SignalCard label="Voice match">
              <VoiceBarsLarge quality={displayedQuality} />
              <span
                className="text-[13px] font-semibold"
                style={{ color: voiceColorFor(displayedQuality) }}
              >
                {voiceLabelFor(displayedQuality)}
              </span>
            </SignalCard>
          </div>
        )}

        {/* Shipped-unedited readout — only for rows that actually shipped
            (approved / published), where "how much did the operator have
            to rewrite" is a meaningful signal. Feeds off `editDistance`
            + current content length; ratio is server-defined in
            `voice-progress.ts` so this always agrees with the chart. */}
        <ShippedUneditedRow
          editDistance={state.editDistance}
          contentLength={displayedContent.length}
          show={approved || isScheduled || isPublished}
        />

        {/* Rule-adherence flags — surfaces when the model broke one of
            the show's parseable voice rules (no hashtags, banned phrase,
            length limit, etc.). Not blocking; the reviewer decides
            whether to regenerate. Hidden while the row is generating or
            has been client-approved (frozen, nothing to act on). */}
        {!isGen &&
          state.ruleViolations &&
          state.ruleViolations.length > 0 &&
          !state.clientApprovedAtIso && (
            <div className="border-b border-[#F1DDBB] bg-[#FBF3E0] px-6 py-[12px]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[12px] font-semibold text-[#A06D12]">
                  Broke {state.ruleViolations.length} voice rule
                  {state.ruleViolations.length === 1 ? "" : "s"}
                </span>
                <span className="font-mono text-[10.5px] tracking-[0.05em] text-[#8A97AD] uppercase">
                  Regenerate to retry
                </span>
              </div>
              <ul className="mt-[6px] flex flex-col gap-[3px] text-[12px] text-[#7A5514]">
                {state.ruleViolations.map((v, i) => (
                  <li key={i}>· {v}</li>
                ))}
              </ul>
            </div>
          )}

        {/* Metadata strip — lifecycle chips (scheduled/published/via) */}
        {(isScheduled || isPublished) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-zinc-100 px-6 py-[10px] text-[11px] text-zinc-500">
            {isPublished && publishedDate ? (
              <MetaBadge tone="ok" label={`Published ${formatShortDateTime(publishedDate)}`} />
            ) : isScheduled && scheduledDate ? (
              <MetaBadge tone="info" label={`Scheduled ${formatShortDateTime(scheduledDate)}`} />
            ) : null}
            <span className="font-mono">{wordCount} words</span>
            {state.externalScheduler === "BUFFER" ? (
              <span className="font-mono">via Buffer</span>
            ) : state.externalScheduler === "MANUAL" ? (
              <span className="font-mono">manual</span>
            ) : null}
          </div>
        )}

        {/* Version history */}
        {hasHistory && !state.editing && (
          <div className="flex items-center justify-between gap-2 border-b border-zinc-100 bg-[#FBFCFE] px-6 py-[8px] text-[11.5px]">
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
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isGen ? (
            <GeneratingBody progress={state.progress} />
          ) : isFailed ? (
            <FailedBody reason={state.failureReason ?? null} />
          ) : state.editing ? (
            <EditingBody state={state} actions={actions} />
          ) : state.showRegen ? (
            <RegenBody state={state} actions={actions} />
          ) : (
            <div className="text-ink text-[13.5px] leading-[1.7] whitespace-pre-wrap">
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
          className="border-t border-zinc-100 bg-white px-6 py-4"
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
            <>
              {state.externalScheduler !== "BUFFER" && roleCanSchedule ? (
                <div className="mb-3">
                  <label
                    htmlFor="mark-published-url"
                    className="text-muted-2 mb-1 block font-mono text-[10.5px] tracking-[0.05em] uppercase"
                  >
                    Post URL (optional)
                  </label>
                  <input
                    id="mark-published-url"
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    placeholder="https://x.com/…"
                    value={markPublishedUrl}
                    onChange={(e) => {
                      setMarkPublishedUrl(e.target.value);
                      if (markPublishedUrlError) setMarkPublishedUrlError(null);
                    }}
                    disabled={pending}
                    className="w-full rounded-md border border-zinc-200 bg-white px-3 py-[7px] font-sans text-[12.5px] text-[#1A2A4A] outline-none focus:border-[#3A5BA0] disabled:opacity-60"
                  />
                  {markPublishedUrlError ? (
                    <div className="mt-1 text-[11px] text-red-700">{markPublishedUrlError}</div>
                  ) : (
                    <div className="text-muted-2 mt-1 text-[11px]">
                      Paste the link if you have it — powers the “View post ↗” shortcut afterwards.
                    </div>
                  )}
                </div>
              ) : null}
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
                        tone: "brand",
                        onClick: submitMarkPublished,
                        disabled: pending,
                      }
                    : undefined
                }
              />
            </>
          ) : isPublished ? (
            <FooterRow
              onCancel={onClose}
              primary={
                state.externalPostUrl
                  ? {
                      label: "View post ↗",
                      tone: "brand",
                      onClick: () => window.open(state.externalPostUrl!, "_blank", "noopener"),
                    }
                  : undefined
              }
            />
          ) : awaitingClient ? (
            /* Row is sitting in the client's portal queue. Approve
               roles get a "Recall from client" affordance so they can
               pull it back, edit, and resend — the only escape hatch
               out of AWAITING_CLIENT_APPROVAL besides waiting for the
               client to act. */
            <FooterRow
              onCancel={onClose}
              secondaryActions={[
                {
                  label: "Copy",
                  onClick: actions.onCopy,
                },
              ]}
              primary={
                roleCanRecall
                  ? {
                      label: "Recall from client",
                      tone: "brand",
                      onClick: actions.onRecall,
                      disabled: pending,
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
                // "Request review" is EDITOR-only; hide it entirely for
                // OWNER/ADMIN/REVIEWER instead of just disabling.
                ...(inReview
                  ? [
                      {
                        label: "Reject",
                        onClick: actions.onReject,
                        disabled: !roleCanApprove,
                      },
                    ]
                  : roleCanRequestReview
                    ? [
                        {
                          label: "Request review",
                          onClick: actions.onRequestReview,
                          disabled: !roleCanEdit,
                        },
                      ]
                    : []),
              ]}
              primary={{
                label: "Approve",
                tone: "brand",
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

/** Attention-toned counterpart to StatusPillLarge — swapped in for the
 *  header pill when the client has bounced this READY output back from
 *  the portal. Same shape as the standard pill so header alignment
 *  doesn't shift. */
function RevisionRequestedPillLarge() {
  return (
    <span
      className="rounded-pill inline-flex flex-shrink-0 items-center gap-[6px] px-[10px] py-[3.5px] font-sans text-[11.5px] font-semibold"
      style={{ background: "#FBEDEC", color: "#A03425" }}
    >
      <span className="block h-[6px] w-[6px] rounded-full" style={{ background: "#A03425" }} />
      Changes requested
    </span>
  );
}

/** Client revision-request context panel — headline + timestamp + the
 *  client's note in a quote-styled block. Rendered above the signal
 *  strip so a reviewer landing from the Clients-nav badge sees the ask
 *  before the quality readout. */
function ClientRevisionPanel({
  requestedAtIso,
  note,
}: {
  requestedAtIso: string;
  note: string | null;
}) {
  const askedAgo = timeAgoFromIso(requestedAtIso);
  return (
    <div className="border-b border-zinc-100 px-6 py-[16px]" style={{ background: "#FEF7F5" }}>
      <div className="flex items-start gap-[10px]">
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: 28,
            height: 28,
            flexShrink: 0,
            background: "#F6D8D2",
            color: "#A03425",
          }}
          aria-hidden
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 3h10v6H5l-3 3V3z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[13px] font-semibold text-[#7A2A1F]">Client asked for changes</div>
            <div className="font-mono text-[10.5px] tracking-[0.03em] text-[#A0645A] uppercase">
              {askedAgo}
            </div>
          </div>
          {note ? (
            <blockquote
              className="mt-[8px] rounded-[8px] px-[12px] py-[10px] text-[12.5px] leading-[1.55] text-[#5A2E26]"
              style={{ background: "#FDEFEC", border: "1px solid #F0CFC2" }}
            >
              <span className="mr-[2px] text-[#B85847]">“</span>
              {note}
              <span className="ml-[1px] text-[#B85847]">”</span>
            </blockquote>
          ) : (
            <div className="mt-[6px] text-[12px] leading-[1.5] text-[#7A5148]">
              The client didn&apos;t leave a note — check the feedback ledger on the client&apos;s
              billing page for context, or edit / regenerate this draft directly.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Bordered white "card" used inside the signal strip. Keeps the two
 *  metric groupings visually parallel and centered so the pattern reads
 *  as a pair rather than two loose rows. */
/**
 * "Shipped X% unedited" — the drawer's per-row expression of the voice
 * progress north-star (see `components/voice/voice-progress-card.tsx`).
 * Renders on approved / scheduled / published rows only; earlier
 * statuses are pre-ship, so the metric isn't meaningful yet.
 *
 * The pct is `100 - editRatio*100` where editRatio is clamped in
 * [0, 1] to match the aggregation in `server/ai/voice-progress.ts`.
 * When the row predates `editDistance` tracking, `editDistance` is
 * undefined — we hide the row rather than showing a misleading 100%.
 */
function ShippedUneditedRow({
  editDistance,
  contentLength,
  show,
}: {
  editDistance: number | undefined;
  contentLength: number;
  show: boolean;
}) {
  if (!show) return null;
  if (editDistance === undefined) return null;
  const len = Math.max(contentLength, 1);
  const rawRatio = editDistance / len;
  const clamped = !Number.isFinite(rawRatio) || rawRatio < 0 ? 0 : Math.min(1, rawRatio);
  const uneditedPct = Math.round((1 - clamped) * 100);
  const postReady = clamped <= 0.1;
  const color = postReady ? "#1E7A47" : uneditedPct >= 50 ? "#3A5BA0" : "#A06D12";
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-zinc-100 bg-white px-6 py-[10px]"
      style={{ fontFamily: "var(--font-revamp-sans)" }}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-semibold" style={{ color }}>
          Shipped {uneditedPct}% unedited
        </span>
        {postReady && (
          <span
            className="font-mono text-[9.5px]"
            style={{
              letterSpacing: "0.08em",
              color: "#1E7A47",
              background: "#E4F3EC",
              padding: "2px 7px",
              borderRadius: 99,
              fontWeight: 700,
            }}
          >
            POST-READY
          </span>
        )}
      </div>
      <span className="font-mono text-[10.5px] text-[#8A97AD]">
        {editDistance} of {contentLength} chars changed
      </span>
    </div>
  );
}

function SignalCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-[12px] bg-white px-[15px] py-[14px]"
      style={{
        border: "1px solid #E8EBF1",
        boxShadow: "0 1px 2px rgba(20,30,60,0.03)",
      }}
    >
      <div className="mb-[9px] font-mono text-[10px] tracking-[0.06em] text-[#9AA3B2] uppercase">
        {label}
      </div>
      <div className="flex items-center gap-[10px]">{children}</div>
    </div>
  );
}

/** Perfect circle around the quality number. Explicit width/height via
 *  inline style + flex-shrink so the flex parent can't squash the badge
 *  into an oval when the neighbour text is long. */
function QualityCircle({ score }: { score: number }) {
  const color = qualityColorFor(score);
  return (
    <span
      className="font-display flex items-center justify-center rounded-full text-[12.5px] font-bold tabular-nums"
      style={{
        width: 38,
        height: 38,
        flexShrink: 0,
        border: `2.5px solid ${color}`,
        color,
      }}
      aria-label={score ? `Quality score ${score}` : "Quality score pending"}
    >
      {score || "—"}
    </span>
  );
}

/** Three ascending voice-match bars in the drawer's signal strip. Slightly
 *  larger than the ones on the card so the drawer surface reads as an
 *  "amplified" version of the same signal. */
function VoiceBarsLarge({ quality }: { quality: number }) {
  const strength = voiceStrengthFor(quality);
  const active = voiceColorFor(quality);
  const muted = "#D8DEE8";
  return (
    <span className="flex items-end gap-[3px]" aria-hidden style={{ flexShrink: 0 }}>
      <span
        className="w-[4px] rounded-[1.5px]"
        style={{ height: 10, background: strength >= 1 ? active : muted }}
      />
      <span
        className="w-[4px] rounded-[1.5px]"
        style={{ height: 14, background: strength >= 2 ? active : muted }}
      />
      <span
        className="w-[4px] rounded-[1.5px]"
        style={{ height: 18, background: strength >= 3 ? active : muted }}
      />
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
  tone?: "success" | "brand" | "schedule" | "danger";
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
  // Same four-tone palette as the card's PrimaryButton — the drawer
  // footer should feel like a continuation of the tile that opened it.
  //   success  → soft mint outlined (Approve, Mark published finalize)
  //   brand    → accent navy `var(--color-accent)` (Save, Regenerate,
  //              Try again — operator finalizing themselves)
  //   schedule → purple #5D3FD3 (Confirm schedule — delegates publish
  //              to Buffer or a manual reminder; pairs with the
  //              Scheduled status pill's purple)
  //   danger   → red (reserved for destructive UX)
  const toneStyle: Record<"success" | "brand" | "schedule" | "danger", CSSProperties> = {
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
    schedule: {
      background: "#5D3FD3",
      color: "#fff",
      border: "1px solid rgba(0,0,0,.06)",
      boxShadow: "0 1px 2px rgba(93,63,211,.22)",
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

/** Coarse "X ago" for the revision panel — accurate enough for a
 *  contextual "when did the client ask for this" hint without pulling
 *  in a date library. */
function timeAgoFromIso(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "just now";
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// ============================================================
// Quality / voice band helpers — mirror the card's helpers so the
// drawer's signal strip reads the same tone as the tile that opened it.
// ============================================================

function qualityColorFor(q: number): string {
  if (q >= 90) return "#1F8A5B";
  if (q >= 75) return "#B7791F";
  return "#C0392B";
}

function qualityNoteFor(q: number): string {
  if (q >= 90) return "Post-ready. No edits suggested.";
  if (q >= 75) return "Solid. Skim for one or two tweaks.";
  if (q > 0) return "Worth a review pass before shipping.";
  return "Waiting on a quality score.";
}

function voiceColorFor(q: number): string {
  if (q >= 85) return "#1F8A5B";
  if (q >= 72) return "#3A5BA0";
  if (q > 0) return "#B7791F";
  return "#8A93A3";
}

function voiceLabelFor(q: number): string {
  if (q >= 85) return "Strong";
  if (q >= 72) return "Growing";
  if (q > 0) return "Developing";
  return "New";
}

function voiceStrengthFor(q: number): 0 | 1 | 2 | 3 {
  if (q >= 85) return 3;
  if (q >= 72) return 2;
  if (q > 0) return 1;
  return 0;
}
