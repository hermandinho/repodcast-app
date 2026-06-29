"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { MemberRole } from "@prisma/client";
import { PlatformBadge } from "@/components/ui/platform-badge";
import { VoiceStrengthBars } from "@/components/ui/voice-strength-bars";
import { ClipMomentsPanel } from "@/components/episodes/clip-moments-panel";
import { OutputCard, type OutputState } from "@/components/episodes/output-card";
import type { SampleShow } from "@/lib/sample-data/shows";
import type { SampleEpisode } from "@/lib/sample-data/episode-outputs";
import type { EpisodeStatus } from "@/lib/sample-data/episode-status";
import { platforms, type PlatformKey, type PlatformMeta } from "@/lib/sample-data/platforms";
import { qualityColor } from "@/lib/sample-data/quality";
import { voiceBg, voiceLabel, voiceTextColor } from "@/lib/sample-data/voice-strength";
import {
  approveOutputAction,
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
    progress: stillGenerating ? prev.progress : 100,
    // Clear the optimistic ticker's target once the server has spoken.
    _startAt: stillGenerating ? prev._startAt : undefined,
    _target: stillGenerating ? prev._target : undefined,
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
  };
}

export function OutputsView({
  client,
  episode,
  viewerRole = MemberRole.OWNER,
  streamUrl = null,
}: {
  client: SampleShow;
  episode: SampleEpisode;
  /** Defaults to OWNER for sample-data mode so every control stays demoable. */
  viewerRole?: MemberRole;
  /**
   * Live-mode SSE endpoint. When null (sample-data mode), no connection is
   * opened — the optimistic ticker is the only driver of progress.
   */
  streamUrl?: string | null;
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
    })),
  );

  const [samples, setSamples] = useState(client.samples);
  const [platformSamples, setPlatformSamples] = useState<Record<PlatformKey, number>>(() => ({
    ...client.platformSamples,
  }));
  // `generateAllRequested` is the user's click; `generatingAll` is derived
  // so it auto-falls to false once no platforms are still ticking. This
  // pattern replaces an earlier `useState` + `setGeneratingAll(false)` in
  // an effect, which Next 16's react-hooks/set-state-in-effect rule flags.
  const [generateAllRequested, setGenerateAllRequested] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tickerActive = outputs.some((o) => o.status === "generating");
  const generatingAll = generateAllRequested && tickerActive;

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
    if (!tickerActive) return;

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
        const data = safeParse<{ outputs: StreamOutputPayload[] }>((ev as MessageEvent).data);
        if (!data) return;
        consecutiveErrors = 0;
        setOutputs((prev) => {
          const byKey = new Map(prev.map((o) => [o.key, o]));
          return data.outputs.map((p) => {
            const old = byKey.get(p.key);
            return old ? mergeOutput(old, p) : buildNewRowFromPayload(p);
          });
        });
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

      es.addEventListener("episode", () => {
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
  }, [streamUrl, tickerActive, router]);

  // Drive progress animation while any output is generating.
  useEffect(() => {
    if (!tickerActive) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      const now = Date.now();
      setOutputs((prev) =>
        prev.map((o) => {
          if (o.status !== "generating") return o;
          if (now < (o._startAt ?? 0)) return o;
          const next = Math.min(100, o.progress + (6 + Math.random() * 10));
          if (next >= 100) {
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
  }, [tickerActive]);

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
    const o = outputs.find((x) => x.key === key);
    if (!o) return;
    update(key, { editing: true, draft: o.content, showRegen: false });
  };

  const onSaveEdit = (key: string) => {
    const o = outputs.find((x) => x.key === key);
    if (!o) return;
    setOutputs((prev) =>
      prev.map((p) => (p.key === key ? { ...p, editing: false, content: p.draft } : p)),
    );
    // Fire-and-forget server save. Action is a no-op in sample-data mode.
    void updateOutputContentAction({ outputId: o.id, content: o.draft })
      .then((result) => {
        if (!result.ok) return;
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
      .catch((err) => console.error("updateOutputContentAction failed", err));
  };

  const onCancelEdit = (key: string) => update(key, { editing: false });
  const onDraftChange = (key: string, next: string) => update(key, { draft: next });
  const onToggleRegen = (key: string) => {
    const o = outputs.find((x) => x.key === key);
    if (!o) return;
    update(key, { showRegen: !o.showRegen, editing: false });
  };
  const onRegenTextChange = (key: string, next: string) => update(key, { regenText: next });

  const regenerate = (key: string, instruction: string) => {
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
        }
      })
      .catch((err) => console.error("regenerateOutputAction failed", err));
  };

  const onApplyRegen = (key: string) => {
    const o = outputs.find((x) => x.key === key);
    if (!o) return;
    regenerate(key, o.regenText);
  };

  const onQuickRegen = (key: string, instruction: string) => regenerate(key, instruction);

  const onRetry = (key: string) => regenerate(key, "");

  const onApprove = (key: string) => {
    const o = outputs.find((x) => x.key === key);
    if (!o) return;
    if (o.status !== "ready" && o.status !== "review") return;
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
    void approveOutputAction({ outputId: o.id })
      .then((result) => {
        if (!result.ok) return;
        track("output_approved", {
          outputId: result.data.outputId,
          platform: o.key,
          edited: result.data.editDistance > 0,
          editDistance: result.data.editDistance,
        });
      })
      .catch((err) => console.error("approveOutputAction failed", err));
  };

  const onRequestReview = (key: string) => {
    const o = outputs.find((x) => x.key === key);
    if (!o || o.status !== "ready") return;
    update(key, { status: "review", showRegen: false, editing: false });
    void requestReviewOutputAction({ outputId: o.id }).catch((err) =>
      console.error("requestReviewOutputAction failed", err),
    );
  };

  const onReject = (key: string) => {
    const o = outputs.find((x) => x.key === key);
    if (!o || o.status !== "review") return;
    update(key, { status: "ready", showRegen: false, editing: false });
    void rejectOutputAction({ outputId: o.id }).catch((err) =>
      console.error("rejectOutputAction failed", err),
    );
  };

  const onRegenAll = () => {
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

  const approvedCount = outputs.filter((o) => o.status === "approved").length;
  const totalCount = outputs.length;
  const approvedPct = Math.round((approvedCount / totalCount) * 100);
  const avgQuality = Math.round(outputs.reduce((sum, o) => sum + o.quality, 0) / totalCount);

  const railRows = useMemo(
    () =>
      outputs.map((o) => ({
        ...o,
        platform: platformByKey.get(o.key)!,
      })),
    [outputs],
  );

  return (
    <div className="flex min-h-full">
      {/* CONTENT */}
      <div className="min-w-0 flex-1 px-7 pt-[26px] pb-[60px]">
        {/* Breadcrumb */}
        <nav className="text-muted-2 mb-[14px] text-[12.5px]">
          <Link href="/clients" className="hover:text-ink">
            Clients
          </Link>
          <span className="mx-[7px] text-[#C3CBD8]">/</span>
          <Link href={`/clients/${client.key}`} className="hover:text-ink">
            {client.name}
          </Link>
          <span className="mx-[7px] text-[#C3CBD8]">/</span>
          <span className="text-muted">{episode.episodeNo}</span>
        </nav>

        {/* Episode header */}
        <div className="mb-[22px] flex flex-wrap items-start gap-6">
          <div className="min-w-[300px] flex-1">
            <h1 className="font-display text-ink text-[27px] leading-[1.18] font-semibold tracking-[-0.5px]">
              {episode.episode}
            </h1>
            <div className="text-muted mt-[7px] text-[13.5px]">
              {client.name} · {episode.episodeMeta}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-[14px]">
            <div className="border-border bg-surface flex items-center gap-[11px] rounded-xl border px-[13px] py-[9px]">
              <div>
                <div className="text-muted-2 mb-[3px] font-sans text-[10.5px] font-semibold tracking-[0.06em] uppercase">
                  Client voice
                </div>
                <div className="flex items-center gap-2">
                  <VoiceStrengthBars samples={samples} size="sm" />
                  <span
                    className="font-sans text-[13px] font-semibold"
                    style={{ color: voiceTextColor(samples) }}
                  >
                    {voiceLabel(samples)}
                  </span>
                  <span className="text-muted-2 text-[12px]">· {samples} samples</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onRegenAll}
              disabled={generatingAll}
              className="shadow-card flex items-center gap-2 rounded-[10px] px-4 py-[11px] font-sans text-[13.5px] font-semibold transition-[filter]"
              style={
                generatingAll
                  ? { background: "#EEF1F6", color: "#A6AEBD", border: "1px solid #E6EBF3" }
                  : {
                      background: "var(--color-accent)",
                      color: "#fff",
                      border: "1px solid rgba(0,0,0,.06)",
                    }
              }
            >
              <span className="text-[11px]">{generatingAll ? "◴" : "▶"}</span>
              {generatingAll ? "Generating…" : "Generate all"}
            </button>
          </div>
        </div>

        {/* Progress strip */}
        <div className="border-border bg-surface mb-5 flex items-center gap-[14px] rounded-xl border px-4 py-[13px]">
          <div className="text-muted text-[13px]">
            <span className="text-ink font-semibold">
              {approvedCount} of {totalCount}
            </span>{" "}
            outputs approved
          </div>
          <div className="h-[6px] max-w-[340px] flex-1 overflow-hidden rounded-md bg-[#EEF1F6]">
            <div
              className="h-full rounded-md bg-[#2E9E5B] transition-[width] duration-500 ease-out"
              style={{ width: `${approvedPct}%` }}
            />
          </div>
          <div className="text-muted-2 text-[12.5px]">
            Each approval trains <span className="text-muted">{client.host}&apos;s</span> voice
            engine
          </div>
        </div>

        {/* Clip moments — null/empty rendering handled inside the panel */}
        <ClipMomentsPanel moments={episode.keyMoments} />

        {/* Output grid */}
        <div
          className="grid gap-[18px]"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}
        >
          {outputs.map((o) => {
            const platform = platformByKey.get(o.key)!;
            return (
              <OutputCard
                key={o.key}
                platform={platform}
                hostName={client.host}
                state={o}
                viewerRole={viewerRole}
                actions={{
                  onCopy: () => onCopy(o.key),
                  onEdit: () => onEdit(o.key),
                  onSaveEdit: () => onSaveEdit(o.key),
                  onCancelEdit: () => onCancelEdit(o.key),
                  onDraftChange: (next) => onDraftChange(o.key, next),
                  onToggleRegen: () => onToggleRegen(o.key),
                  onRegenTextChange: (next) => onRegenTextChange(o.key, next),
                  onApplyRegen: () => onApplyRegen(o.key),
                  onQuickRegen: (inst) => onQuickRegen(o.key, inst),
                  onApprove: () => onApprove(o.key),
                  onRequestReview: () => onRequestReview(o.key),
                  onReject: () => onReject(o.key),
                  onRetry: () => onRetry(o.key),
                }}
              />
            );
          })}
        </div>
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

        {/* Voice by platform */}
        <div className="border-border bg-surface mb-[18px] rounded-2xl border p-[18px]">
          <div className="font-display text-ink text-[14px] font-semibold">Voice by platform</div>
          <div className="text-muted-2 mt-1 mb-[14px] text-[12px]">
            Each platform trains independently
          </div>
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
        </div>

        {/* Output quality */}
        <div className="border-border bg-surface rounded-2xl border p-[18px]">
          <div className="font-display text-ink text-[14px] font-semibold">Output quality</div>
          <div className="text-muted-2 mt-1 mb-[14px] text-[12px]">
            This episode · avg <span className="text-muted font-semibold">{avgQuality}</span>
          </div>
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
        </div>
      </aside>
    </div>
  );
}
