"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { MemberRole } from "@/lib/enums";
import { PlatformBadge } from "@/components/ui/platform-badge";
import { VoiceStrengthBars } from "@/components/ui/voice-strength-bars";
import { ClipMomentsPanel } from "@/components/episodes/clip-moments-panel";
import { GeneratingPanel } from "@/components/episodes/generating-panel";
import { ImportFailedPanel } from "@/components/episodes/import-failed-panel";
import { ImportingPanel } from "@/components/episodes/importing-panel";
import { OutputCard, type OutputState } from "@/components/episodes/output-card";
import { OutputDrawer } from "@/components/episodes/output-drawer";
import { TranscribingPanel } from "@/components/episodes/transcribing-panel";
import type { SampleShow } from "@/lib/sample-data/shows";
import type { SampleEpisode } from "@/lib/sample-data/episode-outputs";
import type { EpisodeStatus } from "@/lib/sample-data/episode-status";
import { platforms, type PlatformKey, type PlatformMeta } from "@/lib/sample-data/platforms";
import { qualityColor } from "@/lib/sample-data/quality";
import { voiceBg, voiceLabel, voiceTextColor } from "@/lib/sample-data/voice-strength";
import {
  approveOutputAction,
  recallOutputAction,
  regenerateOutputAction,
  rejectOutputAction,
  requestReviewOutputAction,
  updateOutputContentAction,
} from "@/app/(dashboard)/episodes/[id]/actions";
import { track } from "@/lib/analytics/track-client";

type LiveOutput = OutputState & {
  _target?: EpisodeStatus;
  _startAt?: number;
};

/**
 * Client-side mirror of `Episode.stage` (see EpisodePipelineStage on the
 * server). Seeded from the RSC prop and thereafter driven by the SSE
 * stream — that's the whole point of the redesign: the panel selection
 * on this page no longer waits for a full `router.refresh()` to notice
 * that transcription is done.
 */
type PipelineStage =
  "pending" | "importing" | "transcribing" | "generating" | "completed" | "failed";

const ACTIVE_STAGES: readonly PipelineStage[] = [
  "pending",
  "importing",
  "transcribing",
  "generating",
];

function normalizeStage(raw: string | null | undefined): PipelineStage | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (
    s === "pending" ||
    s === "importing" ||
    s === "transcribing" ||
    s === "generating" ||
    s === "completed" ||
    s === "failed"
  ) {
    return s;
  }
  return null;
}

const REGEN_ALL_TARGETS: EpisodeStatus[] = [
  "approved",
  "approved",
  "review",
  "ready",
  "review",
  "ready",
  "ready",
];

const platformByKey = new Map<string, PlatformMeta>(platforms.map((p) => [p.key, p]));

/**
 * Wire payload for one output, pushed from `/api/episodes/[id]/stream`.
 * Mirrored on the server in `app/api/episodes/[id]/stream/route.ts`.
 */
type StreamOutputPayload = {
  key: string;
  id: string;
  status: EpisodeStatus;
  content: string;
  quality: number;
  version: number;
  versionCount: number;
  failureReason: string | null;
  sentToClientAtIso: string | null;
  clientApprovedAtIso: string | null;
};

/**
 * Merge a server payload into an existing local row. Preserves transient UI
 * state (editing/draft/showRegen/justCopied/...) so a poll arriving while
 * the user is mid-edit doesn't clobber their draft. Status, content, id,
 * quality, version, versionCount, and failureReason are always server-led —
 * once SSE delivers them, the optimistic ticker stops applying.
 */
function mergeOutput(prev: LiveOutput, payload: StreamOutputPayload): LiveOutput {
  const stillGenerating = payload.status === "generating";
  return {
    ...prev,
    id: payload.id,
    status: payload.status,
    quality: payload.quality,
    content: prev.editing ? prev.content : payload.content,
    version: payload.version,
    versionCount: payload.versionCount,
    failureReason: payload.failureReason,
    sentToClientAtIso: payload.sentToClientAtIso,
    clientApprovedAtIso: payload.clientApprovedAtIso,
    progress: stillGenerating ? prev.progress : 100,
    // Clear the optimistic ticker's target once the server has spoken.
    _startAt: stillGenerating ? prev._startAt : undefined,
    _target: stillGenerating ? prev._target : undefined,
  };
}

/**
 * Reconcile a fresh server `SampleOutput` prop into an existing local row.
 * Runs from the prop-sync effect below whenever `episode.outputs` gets a
 * new reference — i.e. after a `router.refresh()` following schedule /
 * unschedule / approve / etc. Server-authoritative fields (status,
 * scheduledForIso, publishedAtIso, externalScheduler, externalPostUrl,
 * quality, version, versionCount, failureReason) overwrite local; editing
 * drafts and other transient UI state are preserved so a stale refresh
 * doesn't blow away in-progress work.
 */
function mergeOutputFromProp(
  prev: LiveOutput,
  incoming: SampleEpisode["outputs"][number],
): LiveOutput {
  const stillGenerating = incoming.status === "generating";
  return {
    ...prev,
    id: incoming.id,
    status: incoming.status,
    quality: incoming.quality,
    content: prev.editing ? prev.content : incoming.content,
    version: incoming.version,
    versionCount: incoming.versionCount,
    failureReason: incoming.failureReason ?? null,
    scheduledForIso: incoming.scheduledForIso ?? null,
    publishedAtIso: incoming.publishedAtIso ?? null,
    externalScheduler: incoming.externalScheduler ?? null,
    externalPostUrl: incoming.externalPostUrl ?? null,
    sentToClientAtIso: incoming.sentToClientAtIso ?? null,
    clientApprovedAtIso: incoming.clientApprovedAtIso ?? null,
    clientRevisionRequestedAtIso: incoming.clientRevisionRequestedAtIso ?? null,
    clientRevisionNote: incoming.clientRevisionNote ?? null,
    editDistance: incoming.editDistance,
    progress: stillGenerating ? prev.progress : 100,
    _startAt: stillGenerating ? prev._startAt : undefined,
    _target: stillGenerating ? prev._target : undefined,
  };
}

function buildNewRowFromProp(incoming: SampleEpisode["outputs"][number]): LiveOutput {
  return {
    key: incoming.key,
    id: incoming.id,
    status: incoming.status,
    quality: incoming.quality,
    content: incoming.content,
    meta: incoming.meta,
    version: incoming.version,
    versionCount: incoming.versionCount,
    editing: false,
    draft: "",
    showRegen: false,
    regenText: "",
    lastInstruction: "",
    progress: incoming.status === "generating" ? 0 : 100,
    justCopied: false,
    justApproved: false,
    failureReason: incoming.failureReason ?? null,
    scheduledForIso: incoming.scheduledForIso ?? null,
    publishedAtIso: incoming.publishedAtIso ?? null,
    externalScheduler: incoming.externalScheduler ?? null,
    externalPostUrl: incoming.externalPostUrl ?? null,
    sentToClientAtIso: incoming.sentToClientAtIso ?? null,
    clientApprovedAtIso: incoming.clientApprovedAtIso ?? null,
    clientRevisionRequestedAtIso: incoming.clientRevisionRequestedAtIso ?? null,
    clientRevisionNote: incoming.clientRevisionNote ?? null,
    editDistance: incoming.editDistance,
  };
}

function buildNewRowFromPayload(payload: StreamOutputPayload): LiveOutput {
  return {
    key: payload.key,
    id: payload.id,
    status: payload.status,
    quality: payload.quality,
    content: payload.content,
    meta: platformByKey.get(payload.key)?.fullName ?? "",
    version: payload.version,
    versionCount: payload.versionCount,
    editing: false,
    draft: "",
    showRegen: false,
    regenText: "",
    lastInstruction: "",
    progress: payload.status === "generating" ? 0 : 100,
    justCopied: false,
    justApproved: false,
    failureReason: payload.failureReason,
    sentToClientAtIso: payload.sentToClientAtIso,
    clientApprovedAtIso: payload.clientApprovedAtIso,
  };
}

export function OutputsView({
  client,
  episode,
  viewerRole = MemberRole.OWNER,
  clientValidationMode = "INTERNAL",
  streamUrl = null,
  readOnly = false,
  bufferConnected = false,
  bufferConnectedPlatforms = [],
}: {
  client: SampleShow;
  episode: SampleEpisode;
  /** Defaults to OWNER for sample-data mode so every control stays demoable. */
  viewerRole?: MemberRole;
  /** Parent client's validation flow — controls post-approval edit gating
   *  on both the card and drawer. Defaults to INTERNAL for demo/sample
   *  contexts where no live client row is around. */
  clientValidationMode?: "INTERNAL" | "CLIENT";
  /**
   * Live-mode SSE endpoint. When null (sample-data mode), no connection is
   * opened — the optimistic ticker is the only driver of progress.
   */
  streamUrl?: string | null;
  /**
   * When true, every mutation action is gated at the UI layer. Set by
   * `page.tsx` from `tenant.impersonation.mode === "read"` — SystemAdmins
   * browsing a tenant in read-only mode used to see optimistic success on
   * approve/reject/edit/regen even though the server was rejecting the
   * request with ForbiddenError. This flag prevents the optimistic flip
   * and grays out the controls so the truth matches what the server does.
   */
  readOnly?: boolean;
  /**
   * Phase 3.3 — whether the agency has an active Buffer integration.
   * Gates the "Force Buffer" radio in the schedule popover.
   */
  bufferConnected?: boolean;
  /**
   * Phase 3.3 — which platforms actually have a Buffer channel behind
   * them. `bufferConnected` reflects the account-level OAuth; this list
   * reflects per-channel presence so the Buffer radio can gray out on
   * platforms Buffer hasn't been given a channel for.
   */
  bufferConnectedPlatforms?: import("@prisma/client").Platform[];
}) {
  const router = useRouter();
  const [outputs, setOutputs] = useState<LiveOutput[]>(() =>
    episode.outputs.map((o) => ({
      key: o.key,
      id: o.id,
      status: o.status,
      quality: o.quality,
      content: o.content,
      meta: o.meta,
      version: o.version,
      versionCount: o.versionCount,
      editing: false,
      draft: "",
      showRegen: false,
      regenText: "",
      lastInstruction: "",
      progress: 100,
      justCopied: false,
      justApproved: false,
      failureReason: o.failureReason ?? null,
      // Phase 3.3 — scheduling fields flow straight from the DB read so
      // the OutputCard can render lifecycle rows + state-driven CTAs
      // without a second data fetch.
      scheduledForIso: o.scheduledForIso ?? null,
      publishedAtIso: o.publishedAtIso ?? null,
      externalScheduler: o.externalScheduler ?? null,
      externalPostUrl: o.externalPostUrl ?? null,
      sentToClientAtIso: o.sentToClientAtIso ?? null,
      clientApprovedAtIso: o.clientApprovedAtIso ?? null,
      clientRevisionRequestedAtIso: o.clientRevisionRequestedAtIso ?? null,
      clientRevisionNote: o.clientRevisionNote ?? null,
      editDistance: o.editDistance,
    })),
  );

  // Local mirror of the pipeline stage. Seeded from the RSC prop, kept
  // fresh by the SSE stream (snapshot + episode events). This is the
  // authoritative signal for panel selection on this page — prior to the
  // stage redesign the panels read `episode.pipeline.awaitingTranscript`
  // directly from the prop and got stuck showing "Transcribing…" until
  // the whole pipeline flipped Episode.status → READY (the one and only
  // status change SSE surfaced), which was the "stuck on transcribing"
  // bug. See `/api/episodes/[id]/stream/route.ts` for the wire format.
  const [pipelineStage, setPipelineStage] = useState<PipelineStage | null>(() =>
    normalizeStage(episode.pipeline?.stage),
  );
  const [pipelineFailureReason, setPipelineFailureReason] = useState<string | null>(
    () => episode.pipeline?.failureReason ?? null,
  );
  // Prop-sync — if the RSC tree re-renders (router.refresh from another
  // effect, mutation revalidation, back/forward nav), reconcile the
  // incoming stage so we don't drift from server truth.
  const lastSyncedStageRef = useRef(episode.pipeline?.stage);
  useEffect(() => {
    const incoming = episode.pipeline?.stage;
    if (lastSyncedStageRef.current === incoming) return;
    lastSyncedStageRef.current = incoming;
    setPipelineStage(normalizeStage(incoming));
    setPipelineFailureReason(episode.pipeline?.failureReason ?? null);
  }, [episode.pipeline?.stage, episode.pipeline?.failureReason]);

  const [samples, setSamples] = useState(client.samples);
  const [platformSamples, setPlatformSamples] = useState<Record<PlatformKey, number>>(() => ({
    ...client.platformSamples,
  }));
  // `generateAllRequested` is the user's click; `generatingAll` is derived
  // so it auto-falls to false once no platforms are still ticking. This
  // pattern replaces an earlier `useState` + `setGeneratingAll(false)` in
  // an effect, which Next 16's react-hooks/set-state-in-effect rule flags.
  const [generateAllRequested, setGenerateAllRequested] = useState(false);
  const [railTab, setRailTab] = useState<"voice" | "quality">("voice");
  /** Which output's drawer is open. `null` = closed. */
  const [drawerKey, setDrawerKey] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Prop-sync: when the parent RSC re-renders (e.g. after a `router.refresh()`
  // following schedule / unschedule / mark-published), `episode.outputs`
  // arrives as a new reference with the fresh server truth. `useState`'s
  // initializer only ran on mount, so without this the local `outputs`
  // state stays stale — the UI keeps showing the pre-schedule state and
  // lets the user re-schedule a post that's already booked. We reconcile
  // server-authoritative fields (status, scheduling metadata, quality,
  // version, etc.) into local rows via `mergeOutputFromProp`, preserving
  // transient UI state (drafts, drawer, optimistic tickers).
  const lastSyncedOutputsRef = useRef(episode.outputs);
  useEffect(() => {
    if (lastSyncedOutputsRef.current === episode.outputs) return;
    lastSyncedOutputsRef.current = episode.outputs;
    setOutputs((prev) => {
      const byKey = new Map(prev.map((o) => [o.key, o]));
      return episode.outputs.map((incoming) => {
        const local = byKey.get(incoming.key);
        return local ? mergeOutputFromProp(local, incoming) : buildNewRowFromProp(incoming);
      });
    });
  }, [episode.outputs]);

  // Background refresh for SCHEDULED rows. Once a row is scheduled the SSE
  // stream terminates (no ticker) — but the sync cron will later flip the
  // status to PUBLISHED (or FAILED) via a Buffer poll. Nothing on the page
  // observes that transition, so without this the UI stays on SCHEDULED
  // and lets the user click Unschedule on a post Buffer has already sent,
  // producing the "can't be unscheduled from status PUBLISHED" error from
  // `unscheduleOutput`. We fix it by nudging `router.refresh()` on tab
  // return (immediate) and every SCHEDULED_POLL_MS while the tab is
  // visible. `router.refresh()` re-fetches the RSC tree; the prop-sync
  // effect above then reconciles the new statuses into local state.
  const hasScheduled = outputs.some((o) => o.status === "scheduled");
  useEffect(() => {
    if (!hasScheduled) return;
    const SCHEDULED_POLL_MS = 30_000;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const startInterval = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(() => {
        if (document.visibilityState === "visible") router.refresh();
      }, SCHEDULED_POLL_MS);
    };
    const stopInterval = () => {
      if (intervalId === null) return;
      clearInterval(intervalId);
      intervalId = null;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
        startInterval();
      } else {
        stopInterval();
      }
    };
    if (document.visibilityState === "visible") startInterval();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopInterval();
    };
  }, [hasScheduled, router]);

  const tickerActive = outputs.some((o) => o.status === "generating");
  // True whenever the user just kicked off a regen/generation that the
  // server hasn't acknowledged yet. `_startAt` is set by `regenerate()` +
  // `onRegenAll()` and cleared by `mergeOutput` once the server confirms
  // the new status. We use it to keep SSE open even after the optimistic
  // ticker has visually settled — otherwise the connection closes while
  // Claude is still working and the real content never reaches the page.
  const awaitingServer = outputs.some((o) => o._startAt !== undefined);
  const generatingAll = generateAllRequested && tickerActive;

  // Episode is in a pre-generation state (RSS / upload pipeline running
  // before any outputs have been created). We still want the SSE channel
  // open so a stage transition (e.g. TRANSCRIBING → GENERATING → COMPLETED)
  // reaches the page without a hard refresh. Driven off the local mirror
  // — that's what fixes the "stuck on transcribing" bug.
  const awaitingPipeline = pipelineStage !== null && ACTIVE_STAGES.includes(pipelineStage);
  // "Pipeline is still doing something" — used to disable Generate all so
  // a user can't race their own regen against the initial pass.
  const pipelineRunning = awaitingPipeline;
  const generateAllDisabled = readOnly || generatingAll || pipelineRunning || outputs.length === 0;

  // ----------------------------------------------------------------
  // SSE — server-pushed status/content updates during generation.
  //
  // Opens only when a live stream URL is configured AND something is in a
  // generating state. The connection auto-closes on `done` (server detects
  // every output settled) or when tickerActive drops to false locally
  // (last optimistic flip happened to land first).
  //
  // Native EventSource auto-reconnects at ~3s on transient drops. We layer
  // an explicit backoff once we've seen >3 consecutive errors so a hard
  // failure doesn't busy-loop the browser.
  // ----------------------------------------------------------------
  useEffect(() => {
    if (!streamUrl) return;
    // Open when something is actively generating OR the pipeline is mid-
    // import (RSS / upload) with no outputs yet OR the user just kicked
    // off a regen we haven't heard back from. The third case is the
    // important one — the optimistic ticker hits 100 % in ~2 s, but
    // Claude can take 5–15 s; without `awaitingServer` the channel would
    // close before the real new content arrives, leaving the page stuck
    // on the v1 placeholder content.
    if (!tickerActive && !awaitingPipeline && !awaitingServer) return;

    let es: EventSource | null = null;
    let cancelled = false;
    let consecutiveErrors = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      if (cancelled) return;
      es = new EventSource(streamUrl);

      const safeParse = <T,>(raw: string): T | null => {
        try {
          return JSON.parse(raw) as T;
        } catch (err) {
          console.error("[stream] parse failed", err);
          return null;
        }
      };

      es.addEventListener("snapshot", (ev) => {
        const data = safeParse<{
          outputs: StreamOutputPayload[];
          episodeStage?: string | null;
          failureReason?: string | null;
        }>((ev as MessageEvent).data);
        if (!data) return;
        consecutiveErrors = 0;
        setOutputs((prev) => {
          const byKey = new Map(prev.map((o) => [o.key, o]));
          return data.outputs.map((p) => {
            const old = byKey.get(p.key);
            return old ? mergeOutput(old, p) : buildNewRowFromPayload(p);
          });
        });
        // Stage-first: apply the wire stage straight to local state so
        // the panels flip immediately, no RSC round-trip required. The
        // `router.refresh()` below is retained for the ancillary props
        // that the SSE stream *doesn't* carry (voice strength, key
        // moments, KPI counts on the surrounding layout).
        const nextStage = normalizeStage(data.episodeStage);
        if (nextStage) setPipelineStage(nextStage);
        setPipelineFailureReason(data.failureReason ?? null);
        router.refresh();
      });

      es.addEventListener("output", (ev) => {
        const payload = safeParse<StreamOutputPayload>((ev as MessageEvent).data);
        if (!payload) return;
        consecutiveErrors = 0;
        setOutputs((prev) => {
          const idx = prev.findIndex((o) => o.key === payload.key);
          if (idx === -1) return [...prev, buildNewRowFromPayload(payload)];
          const next = prev.slice();
          next[idx] = mergeOutput(prev[idx], payload);
          return next;
        });
      });

      es.addEventListener("episode", (ev) => {
        const data = safeParse<{
          status: string;
          stage: string;
          failureReason: string | null;
        }>((ev as MessageEvent).data);
        if (data) {
          const nextStage = normalizeStage(data.stage);
          if (nextStage) setPipelineStage(nextStage);
          setPipelineFailureReason(data.failureReason ?? null);
        }
        // Voice-strength badges in the right rail + the parent layout's
        // KPI counts go stale once an episode-level flip lands. Soft refresh
        // the surrounding RSC tree without reloading our local state.
        router.refresh();
      });

      es.addEventListener("done", () => {
        cancelled = true;
        es?.close();
      });

      es.onerror = () => {
        consecutiveErrors += 1;
        // Let the native ~3s auto-reconnect handle the first few blips.
        if (consecutiveErrors > 3) {
          es?.close();
          es = null;
          const wait = Math.min(30_000, 1000 * Math.pow(2, consecutiveErrors - 3));
          retryTimer = setTimeout(() => {
            if (!cancelled) open();
          }, wait);
        }
      };
    };

    open();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [streamUrl, tickerActive, awaitingPipeline, awaitingServer, router]);

  // Fire a browser notification when the pipeline settles on a terminal
  // stage while the user isn't looking. Only fires on transitions
  // out of an active stage — a fresh page load where the episode is
  // already COMPLETED shouldn't ping the user again. Gated on
  // `document.hidden` so we don't disturb the user when they're
  // actively watching this tab.
  const lastNotifiedStageRef = useRef<PipelineStage | null>(pipelineStage);
  useEffect(() => {
    const prev = lastNotifiedStageRef.current;
    lastNotifiedStageRef.current = pipelineStage;
    if (prev === pipelineStage) return;
    const prevWasActive = prev !== null && ACTIVE_STAGES.includes(prev);
    const nowTerminal = pipelineStage === "completed" || pipelineStage === "failed";
    if (!prevWasActive || !nowTerminal) return;
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    if (!document.hidden) return;
    try {
      const title =
        pipelineStage === "completed" ? "Your episode is ready" : "Your episode couldn't finish";
      const body =
        pipelineStage === "completed"
          ? `"${episode.episode}" — outputs are waiting for review.`
          : `"${episode.episode}" — the pipeline stopped. Open the page for details.`;
      const notification = new Notification(title, {
        body,
        tag: `episode-${episode.id}`,
        icon: "/favicon.ico",
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch (err) {
      // Browsers occasionally throw on constructor in obscure states
      // (e.g. private mode, permissions revoked between check + call).
      // Silently drop — the completion email is the durable fallback.
      console.warn("[episodes] notification fire failed", err);
    }
  }, [pipelineStage, episode.id, episode.episode]);

  // Drive progress animation while any output is generating.
  //
  // In **live mode** the server (SSE) is authoritative for status +
  // content. The ticker only handles the visual fill — it advances toward
  // ~92 % and then HOLDS there until the server confirms via SSE. The
  // mergeOutput payload will then flip status, replace content, and clear
  // `_startAt`, which dries up `tickerActive` and stops this effect.
  //
  // In **sample-data mode** there is no SSE, so the ticker has to flip
  // status itself when it hits 100 % — otherwise the card would dangle
  // at "generating" forever in the design preview.
  useEffect(() => {
    if (!tickerActive) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    if (timerRef.current) return;
    const isLive = streamUrl !== null;
    const cap = isLive ? 92 : 100;
    timerRef.current = setInterval(() => {
      const now = Date.now();
      setOutputs((prev) =>
        prev.map((o) => {
          if (o.status !== "generating") return o;
          if (now < (o._startAt ?? 0)) return o;
          const next = Math.min(cap, o.progress + (6 + Math.random() * 10));
          // Only auto-flip in sample-data mode. In live mode SSE owns the
          // status transition — we just hold the bar at `cap`.
          if (!isLive && next >= 100) {
            return { ...o, progress: 100, status: o._target ?? "ready" };
          }
          return { ...o, progress: next };
        }),
      );
    }, 110);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [tickerActive, streamUrl]);

  const update = (key: string, patch: Partial<LiveOutput>) => {
    setOutputs((prev) => prev.map((o) => (o.key === key ? { ...o, ...patch } : o)));
  };

  const onCopy = (key: string) => {
    const o = outputs.find((x) => x.key === key);
    if (!o) return;
    try {
      navigator.clipboard?.writeText(o.content);
    } catch {
      /* ignore */
    }
    update(key, { justCopied: true });
    window.setTimeout(() => update(key, { justCopied: false }), 1300);
  };

  const onEdit = (key: string) => {
    if (readOnly) return;
    const o = outputs.find((x) => x.key === key);
    if (!o) return;
    update(key, { editing: true, draft: o.content, showRegen: false });
  };

  const onSaveEdit = (key: string) => {
    if (readOnly) return;
    const o = outputs.find((x) => x.key === key);
    if (!o) return;
    const prevContent = o.content;
    setOutputs((prev) =>
      prev.map((p) => (p.key === key ? { ...p, editing: false, content: p.draft } : p)),
    );
    // Fire-and-forget server save. Action is a no-op in sample-data mode.
    // On server rejection (e.g. read-only impersonation slipping past the UI
    // gate) we roll back to the pre-edit content so the UI matches truth.
    void updateOutputContentAction({ outputId: o.id, content: o.draft })
      .then((result) => {
        if (!result.ok) {
          update(key, { content: prevContent });
          return;
        }
        // Only fire the analytics event when the save actually changed
        // bytes — `delta === 0` means the user "saved" the same content.
        if (result.data.delta > 0) {
          track("output_edited", {
            outputId: result.data.outputId,
            platform: o.key,
            delta: result.data.delta,
            totalEditDistance: result.data.totalEditDistance,
          });
        }
      })
      .catch((err) => {
        console.error("updateOutputContentAction failed", err);
        update(key, { content: prevContent });
      });
  };

  const onCancelEdit = (key: string) => update(key, { editing: false });
  const onDraftChange = (key: string, next: string) => update(key, { draft: next });
  const onToggleRegen = (key: string) => {
    if (readOnly) return;
    const o = outputs.find((x) => x.key === key);
    if (!o) return;
    update(key, { showRegen: !o.showRegen, editing: false });
  };
  const onRegenTextChange = (key: string, next: string) => update(key, { regenText: next });

  const regenerate = (key: string, instruction: string) => {
    if (readOnly) return;
    const o = outputs.find((x) => x.key === key);
    if (!o) return;
    // `regenerate` is an event-handler closure — `Date.now()` is called on
    // click, never during render. The react-hooks/purity rule can't tell
    // the difference from a literal call site, hence the disable.
    // eslint-disable-next-line react-hooks/purity
    const startAt = Date.now();
    const trimmed = instruction.trim();
    // Mirror the server's nextStatus rule in regenerate-output.ts:
    // an instruction routes to IN_REVIEW; a clean retry routes to READY.
    const target: EpisodeStatus = trimmed ? "review" : "ready";
    // Snapshot state we'd need to restore if the server rejects the write.
    const snapshot = {
      status: o.status,
      version: o.version,
      versionCount: o.versionCount,
      lastInstruction: o.lastInstruction,
      failureReason: o.failureReason ?? null,
    };
    // Optimistic: bump version + versionCount so the switcher controls
    // appear immediately, even before the server returns the new id.
    update(key, {
      status: "generating",
      progress: 0,
      _startAt: startAt,
      _target: target,
      showRegen: false,
      regenText: "",
      lastInstruction: trimmed,
      version: o.version + 1,
      versionCount: o.versionCount + 1,
      failureReason: null,
    });
    void regenerateOutputAction({
      outputId: o.id,
      instruction: trimmed || undefined,
    })
      .then((result) => {
        // In live mode the action returns the new row's id; swap it in so
        // subsequent edits/approves/version-history calls hit the right row.
        if (result?.ok) {
          update(key, { id: result.data.outputId });
        } else {
          // Server rejected — revert the optimistic status + version bumps.
          update(key, {
            status: snapshot.status,
            version: snapshot.version,
            versionCount: snapshot.versionCount,
            lastInstruction: snapshot.lastInstruction,
            failureReason: snapshot.failureReason,
            progress: 100,
            _startAt: undefined,
            _target: undefined,
          });
        }
      })
      .catch((err) => {
        console.error("regenerateOutputAction failed", err);
        update(key, {
          status: snapshot.status,
          version: snapshot.version,
          versionCount: snapshot.versionCount,
          lastInstruction: snapshot.lastInstruction,
          failureReason: snapshot.failureReason,
          progress: 100,
          _startAt: undefined,
          _target: undefined,
        });
      });
  };

  const onApplyRegen = (key: string) => {
    const o = outputs.find((x) => x.key === key);
    if (!o) return;
    regenerate(key, o.regenText);
  };

  const onQuickRegen = (key: string, instruction: string) => regenerate(key, instruction);

  const onRetry = (key: string) => regenerate(key, "");

  const onApprove = (key: string) => {
    if (readOnly) return;
    const o = outputs.find((x) => x.key === key);
    if (!o) return;
    if (o.status !== "ready" && o.status !== "review") return;
    const prevStatus = o.status;
    update(key, {
      status: "approved",
      justApproved: true,
      showRegen: false,
      editing: false,
    });
    setSamples((s) => s + 1);
    setPlatformSamples((ps) => ({
      ...ps,
      [o.key]: (ps[o.key as PlatformKey] ?? 0) + 1,
    }));
    window.setTimeout(() => update(key, { justApproved: false }), 1900);
    // Roll back the optimistic approval if the server rejects (e.g. read-
    // only impersonation slipping past the UI gate). This is the specific
    // bug that motivated the readOnly flag — the optimistic UI used to show
    // "Approved" indefinitely even when the API returned ForbiddenError.
    const rollback = () => {
      update(key, { status: prevStatus, justApproved: false });
      setSamples((s) => Math.max(0, s - 1));
      setPlatformSamples((ps) => ({
        ...ps,
        [o.key]: Math.max(0, (ps[o.key as PlatformKey] ?? 0) - 1),
      }));
    };
    void approveOutputAction({ outputId: o.id })
      .then((result) => {
        if (!result.ok) {
          rollback();
          return;
        }
        // Derived north-star metrics — the aggregation module owns the
        // ratio math (`voice-progress.ts#editRatioFor` / `isPostReady`);
        // mirror the same clamp + threshold here so PostHog and the
        // in-app chart agree. `contentLength` is taken from the local
        // row, which already reflects any user edits the operator made
        // before hitting approve.
        const contentLength = Math.max(o.content.length, 1);
        const editRatio = Math.min(1, Math.max(0, result.data.editDistance / contentLength));
        track("output_approved", {
          outputId: result.data.outputId,
          platform: o.key,
          edited: result.data.editDistance > 0,
          editDistance: result.data.editDistance,
          showId: result.data.showId,
          editRatio,
          postReady: editRatio <= 0.1,
        });
      })
      .catch((err) => {
        console.error("approveOutputAction failed", err);
        rollback();
      });
  };

  const onRequestReview = (key: string) => {
    if (readOnly) return;
    const o = outputs.find((x) => x.key === key);
    if (!o || o.status !== "ready") return;
    const prevStatus = o.status;
    update(key, { status: "review", showRegen: false, editing: false });
    void requestReviewOutputAction({ outputId: o.id })
      .then((result) => {
        if (!result.ok) update(key, { status: prevStatus });
      })
      .catch((err) => {
        console.error("requestReviewOutputAction failed", err);
        update(key, { status: prevStatus });
      });
  };

  const onReject = (key: string) => {
    if (readOnly) return;
    const o = outputs.find((x) => x.key === key);
    if (!o || o.status !== "review") return;
    const prevStatus = o.status;
    update(key, { status: "ready", showRegen: false, editing: false });
    void rejectOutputAction({ outputId: o.id })
      .then((result) => {
        if (!result.ok) update(key, { status: prevStatus });
      })
      .catch((err) => {
        console.error("rejectOutputAction failed", err);
        update(key, { status: prevStatus });
      });
  };

  // Recall an AWAITING_CLIENT_APPROVAL output back to READY so the
  // agency can edit / regen before resending. Optimistic flip; roll
  // back on server error. Also drops `sentToClientAtIso` so the
  // "sent to client at …" chip in the drawer stops rendering.
  const onRecall = (key: string) => {
    if (readOnly) return;
    const o = outputs.find((x) => x.key === key);
    if (!o || o.status !== "awaiting-client") return;
    const prevStatus = o.status;
    const prevSentToClientAtIso = o.sentToClientAtIso;
    update(key, {
      status: "ready",
      showRegen: false,
      editing: false,
      sentToClientAtIso: null,
    });
    void recallOutputAction({ outputId: o.id })
      .then((result) => {
        if (!result.ok) {
          update(key, { status: prevStatus, sentToClientAtIso: prevSentToClientAtIso });
        }
      })
      .catch((err) => {
        console.error("recallOutputAction failed", err);
        update(key, { status: prevStatus, sentToClientAtIso: prevSentToClientAtIso });
      });
  };

  const onRegenAll = () => {
    if (readOnly) return;
    if (generatingAll) return;
    const now = Date.now();
    setOutputs((prev) =>
      prev.map((o, i) => ({
        ...o,
        status: "generating",
        progress: 0,
        _startAt: now + i * 650,
        _target: REGEN_ALL_TARGETS[i] ?? "ready",
        showRegen: false,
        editing: false,
      })),
    );
    setGenerateAllRequested(true);
  };

  // "Approved" on the KPI strip means "fully signed off" — the row is
  // past every approval gate that still owes a decision. `approved` is
  // the momentary state after the last sign-off; `scheduled` and
  // `published` are further along the pipeline but the row can only
  // reach them by being approved first, so they still count. NOT
  // counted: `awaiting-client` — the internal team has passed it on,
  // but the client hasn't approved yet, so it's not truly approved.
  const APPROVAL_COMPLETE_STATUSES = new Set<EpisodeStatus>(["approved", "scheduled", "published"]);
  const approvedCount = outputs.filter((o) => APPROVAL_COMPLETE_STATUSES.has(o.status)).length;
  const totalCount = outputs.length;
  // Guard against `0 / 0 → NaN`: when no outputs exist yet (RSS / upload
  // mid-import) the page should show neutral placeholders, not "NaN%".
  const approvedPct = totalCount > 0 ? Math.round((approvedCount / totalCount) * 100) : 0;
  // Average quality across outputs that actually carry a score (some rows
  // are still GENERATING with quality=0 before the pipeline writes one).
  // Render as `null` when there's nothing to average so the UI can show
  // a "—" instead of "NaN".
  const scored = outputs.filter((o) => o.quality > 0);
  const avgQuality =
    scored.length > 0
      ? Math.round(scored.reduce((sum, o) => sum + o.quality, 0) / scored.length)
      : null;

  const railRows = useMemo(
    () =>
      outputs.map((o) => ({
        ...o,
        platform: platformByKey.get(o.key)!,
      })),
    [outputs],
  );

  return (
    <div className="min-w-0 flex-1">
      {/* Q1 wk10 UI revamp — the outer padding, breadcrumb, title, and
          tab bar all moved to the shared layout at ../layout.tsx.
          `client` here is a SHOW (legacy prop name from the pre-hierarchy
          days) — used for scheduling context, not for header rendering. */}
      <div>
        {/* Q1 wk10 UI revamp — breadcrumb + title + tab bar moved to the
            shared episode layout. The Outputs tab now opens directly on
            the outputs-specific action row: "Generate all" + optional
            "Download for client". The Artwork/Clips/Audiograms buttons
            are gone from here — they became tab entries. */}
        <div className="mb-[18px] flex flex-wrap items-center justify-between gap-3">
          <div className="text-muted-2 text-[13px]">
            {outputs.length > 0
              ? `${outputs.length} platform output${outputs.length === 1 ? "" : "s"}`
              : "No outputs yet"}
          </div>
          <div className="flex flex-shrink-0 flex-wrap items-center gap-[10px]">
            <button
              type="button"
              onClick={onRegenAll}
              disabled={generateAllDisabled}
              title={
                readOnly
                  ? "Read-only impersonation — writes are disabled"
                  : pipelineRunning
                    ? "Waiting for episode to finish importing"
                    : outputs.length === 0
                      ? "No outputs to regenerate yet"
                      : undefined
              }
              className="shadow-card flex items-center gap-2 rounded-[10px] px-4 py-[10px] font-sans text-[13px] font-semibold transition-[filter]"
              style={
                generateAllDisabled
                  ? { background: "#EEF1F6", color: "#A6AEBD", border: "1px solid #E6EBF3" }
                  : {
                      background: "var(--color-accent)",
                      color: "#fff",
                      border: "1px solid rgba(0,0,0,.06)",
                    }
              }
            >
              <span className="text-[11px]">{generatingAll || pipelineRunning ? "◴" : "▶"}</span>
              {generatingAll
                ? "Generating…"
                : pipelineRunning
                  ? "Waiting for episode…"
                  : "Regenerate all"}
            </button>

            {/* Branded HTML export. Live mode only (sample-data mode would
                503 the route); approved-only — gated on at least one
                approval so the export isn't an empty receipt. */}
            {streamUrl !== null && approvedCount > 0 && (
              <a
                href={`/api/episodes/${episode.id}/export`}
                download
                className="border-border text-ink hover:bg-canvas shadow-card flex items-center gap-2 rounded-[10px] border bg-white px-4 py-[10px] font-sans text-[13px] font-semibold transition-colors"
                title="Download a branded HTML deliverables receipt to send to the client"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M7 1.5v8M3.5 6L7 9.5 10.5 6" />
                  <path d="M2 12h10" />
                </svg>
                Download for client
              </a>
            )}
          </div>
        </div>

        {/* KPI strip — approval progress · avg quality · voice status.
            Vertical dividers separate the three groups per ref, and the
            trainer copy lives on the right so the eye reads the row as
            "state on the left, provenance on the right". */}
        <div className="border-border bg-surface mb-[22px] flex flex-wrap items-center gap-x-4 gap-y-[10px] rounded-[14px] border px-4 py-[13px] sm:gap-x-[22px] sm:px-[22px] sm:py-[15px]">
          <div className="flex min-w-0 flex-1 items-center gap-[12px] sm:min-w-[200px]">
            <div className="text-[14px] whitespace-nowrap text-[#5A6473]">
              <span className="font-display text-ink text-[15px] font-bold">
                {approvedCount} of {totalCount}
              </span>{" "}
              approved
            </div>
            <div className="h-[8px] min-w-[120px] flex-1 overflow-hidden rounded-[5px] bg-[#EAEEF4]">
              <div
                className="h-full rounded-[5px] bg-[#1F8A5B] transition-[width] duration-500 ease-out"
                style={{ width: `${approvedPct}%` }}
              />
            </div>
          </div>

          <span className="hidden h-[26px] w-px bg-[#E8EBF1] sm:block" />

          <div className="flex items-center gap-[6px] text-[14px] whitespace-nowrap text-[#5A6473]">
            <span>Avg quality</span>
            <span className="font-display text-ink text-[15px] font-bold">
              {avgQuality === null ? "—" : avgQuality}
            </span>
          </div>

          <span className="hidden h-[26px] w-px bg-[#E8EBF1] sm:block" />

          <div className="flex items-center gap-[8px] whitespace-nowrap">
            <VoiceStrengthBars samples={samples} size="sm" />
            <span
              className="font-sans text-[13.5px] font-semibold"
              style={{ color: voiceTextColor(samples) }}
            >
              {voiceLabel(samples)}
            </span>
            <span className="text-muted-2 font-mono text-[12px]">· {samples} samples</span>
          </div>

          <div className="text-muted-2 basis-full text-[13px] sm:ml-auto sm:basis-auto">
            Each approval trains{" "}
            <span className="text-muted font-medium">{client.host}&apos;s</span> voice engine
          </div>
        </div>

        {/* Pre-generation empty states so the page never looks blank
            while the pipeline is doing its work. Driven by the local
            `pipelineStage` mirror — the SSE stream keeps it in sync so
            transitions (TRANSCRIBING → GENERATING → COMPLETED) flip the
            panel immediately, no RSC refresh required.

            Priority:
              1. FAILED → error banner (always, even if some outputs
                 landed before the failure tripped).
              2. UPLOAD in pending/transcribing → Deepgram is running.
              3. RSS/YOUTUBE in pending/importing/transcribing before
                 outputs exist → import (+ optional audio-fallback
                 transcribe) in flight.
              4. GENERATING with no outputs yet → the initial fan-out
                 hasn't landed. Covers PASTE end-to-end and the
                 UPLOAD/RSS/YOUTUBE window after transcript lands but
                 before generate-episode persists the first row. */}
        {pipelineStage === "failed" && episode.pipeline ? (
          <ImportFailedPanel
            source={episode.pipeline.source}
            reason={pipelineFailureReason}
            showId={client.key}
            clientId={client.clientKey}
          />
        ) : episode.pipeline?.source === "UPLOAD" &&
          (pipelineStage === "pending" || pipelineStage === "transcribing") &&
          outputs.length === 0 ? (
          <TranscribingPanel episodeId={episode.id} />
        ) : episode.pipeline &&
          (episode.pipeline.source === "RSS" || episode.pipeline.source === "YOUTUBE") &&
          (pipelineStage === "pending" ||
            pipelineStage === "importing" ||
            pipelineStage === "transcribing") &&
          outputs.length === 0 ? (
          <ImportingPanel source={episode.pipeline.source} />
        ) : pipelineStage === "generating" && outputs.length === 0 && episode.pipeline ? (
          <GeneratingPanel source={episode.pipeline.source} />
        ) : null}

        {/* Clip moments — null/empty rendering handled inside the panel */}
        <ClipMomentsPanel moments={episode.keyMoments} />

        {/* Output grid — per ref/details-full.html, `minmax(272px, 1fr)`
             yields 3 columns at typical main widths and 4 on very wide
             screens, giving each tile enough room for the preview box +
             signals + button row without cramping. */}
        <div
          className="grid items-stretch gap-[18px]"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(272px, 1fr))" }}
        >
          {outputs.map((o) => {
            const platform = platformByKey.get(o.key)!;
            const cardActions = {
              onCopy: () => onCopy(o.key),
              onEdit: () => onEdit(o.key),
              onSaveEdit: () => onSaveEdit(o.key),
              onCancelEdit: () => onCancelEdit(o.key),
              onDraftChange: (next: string) => onDraftChange(o.key, next),
              onToggleRegen: () => onToggleRegen(o.key),
              onRegenTextChange: (next: string) => onRegenTextChange(o.key, next),
              onApplyRegen: () => onApplyRegen(o.key),
              onQuickRegen: (inst: string) => onQuickRegen(o.key, inst),
              onApprove: () => onApprove(o.key),
              onRequestReview: () => onRequestReview(o.key),
              onReject: () => onReject(o.key),
              onRecall: () => onRecall(o.key),
              onRetry: () => onRetry(o.key),
            };
            return (
              <OutputCard
                key={o.key}
                platform={platform}
                hostName={client.host}
                state={o}
                episodeId={episode.id}
                viewerRole={viewerRole}
                clientValidationMode={clientValidationMode}
                readOnly={readOnly}
                bufferConnected={bufferConnected}
                bufferConnectedPlatforms={bufferConnectedPlatforms}
                onOpen={() => setDrawerKey(o.key)}
                actions={cardActions}
              />
            );
          })}
        </div>

        {/* Details drawer — one instance across all cards; opened via
             `setDrawerKey`. Renders `null` when nothing is open so it
             stays out of the a11y tree. */}
        {(() => {
          if (drawerKey === null) return null;
          const o = outputs.find((row) => row.key === drawerKey);
          if (!o) return null;
          const platform = platformByKey.get(o.key)!;
          const drawerActions = {
            onCopy: () => onCopy(o.key),
            onEdit: () => onEdit(o.key),
            onSaveEdit: () => onSaveEdit(o.key),
            onCancelEdit: () => onCancelEdit(o.key),
            onDraftChange: (next: string) => onDraftChange(o.key, next),
            onToggleRegen: () => onToggleRegen(o.key),
            onRegenTextChange: (next: string) => onRegenTextChange(o.key, next),
            onApplyRegen: () => onApplyRegen(o.key),
            onQuickRegen: (inst: string) => onQuickRegen(o.key, inst),
            onApprove: () => onApprove(o.key),
            onRequestReview: () => onRequestReview(o.key),
            onReject: () => onReject(o.key),
            onRecall: () => onRecall(o.key),
            onRetry: () => onRetry(o.key),
          };
          return (
            <OutputDrawer
              platform={platform}
              hostName={client.host}
              state={o}
              episodeId={episode.id}
              viewerRole={viewerRole}
              clientValidationMode={clientValidationMode}
              readOnly={readOnly}
              bufferConnected={bufferConnected}
              bufferConnectedPlatforms={bufferConnectedPlatforms}
              onClose={() => setDrawerKey(null)}
              actions={drawerActions}
            />
          );
        })()}
      </div>

      {/* RIGHT RAIL */}
      <aside
        className="border-border bg-surface-2 sticky top-0 w-[336px] flex-shrink-0 self-start overflow-y-auto border-l px-[22px] py-6 pb-[60px]"
        style={{ maxHeight: "calc(100vh - var(--topbar-height))" }}
      >
        {/* AI voice profile card */}
        <div className="border-border bg-surface mb-[18px] rounded-2xl border p-[18px]">
          <div className="mb-[14px] flex items-center gap-[6px]">
            <svg
              width="15"
              height="15"
              viewBox="0 0 15 15"
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M2 7.5v0M5 4v7M7.5 1.5v12M10 4.5v6M13 7.5v0" />
            </svg>
            <span className="font-display text-ink text-[14.5px] font-semibold">
              AI voice profile
            </span>
          </div>

          <div className="mb-[14px] flex items-center gap-[11px]">
            <div
              className="font-display flex h-[38px] w-[38px] items-center justify-center rounded-[10px] text-[15px] font-bold text-white"
              style={{ background: client.avatarBg }}
            >
              {client.initial}
            </div>
            <div>
              <div className="text-ink text-[13.5px] font-semibold">{client.host}</div>
              <div className="text-muted-2 text-[12px]">{client.name}</div>
            </div>
          </div>

          <div
            className="mb-[14px] rounded-[11px] p-[13px]"
            style={{ background: voiceBg(samples) }}
          >
            <div className="mb-[9px] flex items-center justify-between">
              <span
                className="font-sans text-[13px] font-semibold"
                style={{ color: voiceTextColor(samples) }}
              >
                {voiceLabel(samples)} voice
              </span>
              <span className="text-muted text-[12px]">{samples} approved samples</span>
            </div>
            <VoiceStrengthBars samples={samples} />
          </div>

          <p className="text-muted font-sans text-[12.5px] leading-[1.6]">{episode.description}</p>
          <div className="text-subtle mt-3 text-[11.5px]">Last trained {episode.lastTrained}</div>
        </div>

        {/* Per-platform card — merges the old "Voice by platform" + "Output
            quality" cards into one tabbed panel. Both rendered the same
            per-platform row shape (badge + label + horizontal bar); tabbing
            them halves the rail's vertical footprint without losing data. */}
        <div className="border-border bg-surface rounded-2xl border p-[18px]">
          <div className="mb-[12px] flex items-center justify-between gap-3">
            <div className="font-display text-ink text-[14px] font-semibold">Per platform</div>
            <div
              role="tablist"
              aria-label="Per-platform metric"
              className="flex items-center gap-[2px] rounded-[8px] bg-[#F1F4F9] p-[3px]"
            >
              {(["voice", "quality"] as const).map((tab) => {
                const active = railTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setRailTab(tab)}
                    className="rounded-[6px] px-[10px] py-[4px] font-sans text-[11.5px] font-semibold capitalize transition-colors"
                    style={
                      active
                        ? {
                            background: "#fff",
                            color: "#2A3550",
                            boxShadow: "0 1px 2px rgba(26,42,74,.08)",
                          }
                        : { color: "#7A8496" }
                    }
                  >
                    {tab}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="text-muted-2 mb-[14px] text-[12px]">
            {railTab === "voice" ? (
              "Each platform trains independently"
            ) : (
              <>
                This episode · avg{" "}
                <span className="text-muted font-semibold">
                  {avgQuality === null ? "—" : avgQuality}
                </span>
              </>
            )}
          </div>

          {railTab === "voice" ? (
            <div className="flex flex-col gap-[13px]">
              {platforms.map((p) => {
                const n = platformSamples[p.key] ?? 0;
                return (
                  <div key={p.key} className="flex items-center gap-[11px]">
                    <PlatformBadge platform={p} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium text-[#39435A]">
                        {p.name}
                      </div>
                    </div>
                    <VoiceStrengthBars samples={n} size="sm" />
                    <span
                      className="w-[62px] text-right font-sans text-[11px] font-medium"
                      style={{ color: voiceTextColor(n) }}
                    >
                      {voiceLabel(n)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {railRows.map((r) => {
                const qc = qualityColor(r.quality);
                return (
                  <div key={r.key} className="flex items-center gap-[11px]">
                    <PlatformBadge platform={r.platform} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="mb-[5px] truncate text-[12.5px] font-medium text-[#39435A]">
                        {r.platform.name}
                      </div>
                      <div className="h-[5px] overflow-hidden rounded-md bg-[#EEF1F6]">
                        <div
                          className="h-full rounded-md"
                          style={{ width: `${r.quality}%`, background: qc }}
                        />
                      </div>
                    </div>
                    <span
                      className="w-6 text-right font-sans text-[12.5px] font-semibold"
                      style={{ color: qc }}
                    >
                      {r.quality}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
