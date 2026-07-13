"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipRenderStatus, Platform } from "@prisma/client";
import { requestAudiogramAction } from "@/app/(dashboard)/episodes/[id]/actions";
import { ReuploadAudio } from "@/components/episodes/reupload-audio";
import { Card } from "@/components/ui/card";
import { translateClipRenderError } from "@/lib/clip-error-messages";

const PLATFORM_LABEL: Record<Platform, string> = {
  TWITTER: "X / Twitter",
  LINKEDIN: "LinkedIn",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  SHOW_NOTES: "Show notes",
  BLOG: "Blog",
  NEWSLETTER: "Newsletter",
};

/**
 * Q1 feature #5 — audiogram management grid, keyed per GeneratedOutput.
 *
 * Same polling shape as clips-list: refresh every 5s while any row is
 * in flight, then stop. Per-row actions dispatch via useTransition so
 * the button briefly disables during the RTT.
 */

export type AudiogramOutputRow = {
  id: string;
  platform: Platform;
  contentPreview: string;
  audiogramStatus: ClipRenderStatus | null;
  audiogramUrl: string | null;
  audiogramPosterUrl: string | null;
  audiogramError: string | null;
  audiogramStartMs: number | null;
  audiogramEndMs: number | null;
  audiogramAspect: string | null;
};

type Props = {
  episodeId: string;
  outputs: AudiogramOutputRow[];
  isReady: boolean;
  notReadyReason: string | null;
  readOnly: boolean;
  /**
   * True when the episode's audio was cleaned up by the (retired) tier-2
   * orphan-audio cron. When set, the "not ready" surfaces show a
   * Re-upload button that restores `audioUrl` and unblocks regeneration.
   */
  audioMissing: boolean;
};

export function AudiogramsList({
  episodeId,
  outputs,
  isReady,
  notReadyReason,
  readOnly,
  audioMissing,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Grace-period polling. Same shape as clips-list — the awaiting
  // window is a nullable timestamp; a 90-s setTimeout in an effect
  // clears it, and the "preparing" derivation depends on both this and
  // whether any row has started its status transitions.
  const [awaitingSince, setAwaitingSince] = useState<number | null>(null);
  const anyStatus = useMemo(() => outputs.some((o) => o.audiogramStatus !== null), [outputs]);
  const preparing = awaitingSince !== null && !anyStatus;

  const inFlightCount = useMemo(
    () =>
      outputs.filter(
        (o) =>
          o.audiogramStatus === ClipRenderStatus.PENDING ||
          o.audiogramStatus === ClipRenderStatus.RENDERING,
      ).length,
    [outputs],
  );

  useEffect(() => {
    if (awaitingSince === null) return;
    const t = setTimeout(() => setAwaitingSince(null), 90_000);
    return () => clearTimeout(t);
  }, [awaitingSince]);

  // Polling triggers, any one is enough:
  //   - `inFlightCount > 0`: something is PENDING/RENDERING — poll for
  //     status transitions.
  //   - `preparing`: first-generate empty-state grace window.
  //   - `awaitingSince !== null`: user just fired ANY action. Needed for
  //     the regenerate-on-existing-READY case where the client hasn't
  //     yet seen the DB's status flip to PENDING, so `inFlightCount` is
  //     stale at 0 and polling would never kick in.
  useEffect(() => {
    if (inFlightCount === 0 && !preparing && awaitingSince === null) return;
    const t = setInterval(() => router.refresh(), 3_000);
    return () => clearInterval(t);
  }, [inFlightCount, router, preparing, awaitingSince]);

  const runAction = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (!res.ok) setError(res.error);
        else {
          setAwaitingSince(Date.now());
          router.refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const onGenerate = (outputId: string) =>
    runAction(async () => requestAudiogramAction({ outputId }));

  const existingAudiograms = outputs.filter(
    (o) => o.audiogramStatus !== null || o.audiogramUrl !== null,
  ).length;

  // Only replace the whole surface with the "not ready" card when the
  // episode isn't ready AND we have nothing to show. If any audiograms
  // exist, keep rendering the list (they're immutable once rendered)
  // and downgrade the reason to a top-of-page banner.
  if (!isReady && existingAudiograms === 0) {
    return (
      <Card className="p-6">
        <div className="font-display text-ink text-[15px] font-semibold">
          Not ready for audiograms
        </div>
        <p className="text-muted-2 mt-1.5 text-[13px] leading-[1.6]">
          {notReadyReason ?? "This episode isn't ready yet."}
        </p>
        {audioMissing && !readOnly && (
          <div className="mt-4">
            <ReuploadAudio episodeId={episodeId} variant="primary" />
          </div>
        )}
      </Card>
    );
  }

  if (outputs.length === 0) {
    return (
      <Card className="p-8 text-center">
        <div className="font-display text-ink text-[16px] font-semibold">No outputs yet</div>
        <p className="text-muted-2 mx-auto mt-1.5 max-w-md text-[13px] leading-[1.6]">
          Audiograms attach to social outputs. Generate outputs first, then come back here.
        </p>
      </Card>
    );
  }

  return (
    <div>
      {!isReady && notReadyReason && (
        <div className="border-border bg-surface-2 text-muted mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-[12.5px] leading-[1.5]">
          <div>
            <strong className="text-ink font-semibold">Heads up:</strong> {notReadyReason} Existing
            audiograms below are still viewable.
          </div>
          {audioMissing && !readOnly && <ReuploadAudio episodeId={episodeId} variant="inline" />}
        </div>
      )}
      <div className="text-muted-2 mb-4 text-[13px]">
        {outputs.length} output{outputs.length === 1 ? "" : "s"}
        {inFlightCount > 0 && <> · {inFlightCount} rendering</>}
      </div>
      {error && (
        <div className="border-danger/40 bg-danger/5 text-danger mb-4 rounded-lg border p-3 text-[12.5px]">
          {error}
        </div>
      )}
      <div className="flex flex-col gap-3">
        {outputs.map((o) => (
          <AudiogramRow
            key={o.id}
            row={o}
            readOnly={readOnly}
            disabled={isPending}
            canGenerate={isReady}
            notReadyReason={notReadyReason}
            onGenerate={() => onGenerate(o.id)}
          />
        ))}
      </div>
    </div>
  );
}

function AudiogramRow({
  row,
  readOnly,
  disabled,
  canGenerate,
  notReadyReason,
  onGenerate,
}: {
  row: AudiogramOutputRow;
  readOnly: boolean;
  disabled: boolean;
  canGenerate: boolean;
  notReadyReason: string | null;
  onGenerate: () => void;
}) {
  const status = row.audiogramStatus;
  const errorTranslation =
    status === ClipRenderStatus.FAILED ? translateClipRenderError(row.audiogramError) : null;

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start">
        {/* Left: platform + text preview */}
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-ink font-display text-[13px] font-semibold">
              {PLATFORM_LABEL[row.platform]}
            </span>
            <AudiogramStatusPill status={status} />
          </div>
          <p className="text-ink line-clamp-3 text-[12.5px] leading-[1.5]">{row.contentPreview}</p>
          {errorTranslation && (
            <div className="mt-2" title={errorTranslation.raw}>
              <p className="text-danger text-[11.5px] font-semibold">{errorTranslation.friendly}</p>
              {errorTranslation.hint && (
                <p className="text-muted-2 text-[11px]">{errorTranslation.hint}</p>
              )}
            </div>
          )}
        </div>

        {/* Right: player or action */}
        <div className="w-full max-w-[240px] flex-shrink-0">
          {status === ClipRenderStatus.READY && row.audiogramUrl ? (
            <AudiogramPreview
              url={row.audiogramUrl}
              posterUrl={row.audiogramPosterUrl}
              aspect={row.audiogramAspect}
              readOnly={readOnly}
              disabled={disabled}
              onRegenerate={onGenerate}
            />
          ) : status === ClipRenderStatus.RENDERING || status === ClipRenderStatus.PENDING ? (
            <div className="bg-surface-3 flex aspect-[9/16] items-center justify-center rounded-lg text-[12px] text-[#525F76]">
              <span className="flex flex-col items-center gap-2">
                <span className="border-muted/30 border-t-accent block h-5 w-5 animate-spin rounded-full border-2" />
                {status === ClipRenderStatus.PENDING ? "Queued" : "Rendering…"}
              </span>
            </div>
          ) : (
            <button
              type="button"
              disabled={readOnly || disabled || !canGenerate}
              onClick={onGenerate}
              title={!canGenerate ? (notReadyReason ?? undefined) : undefined}
              className="border-border text-ink hover:bg-canvas shadow-card flex w-full items-center justify-center gap-2 rounded-[10px] border bg-white px-4 py-[10px] font-sans text-[13px] font-semibold transition-colors disabled:opacity-60"
            >
              {status === ClipRenderStatus.FAILED ? "Retry audiogram" : "Generate audiogram"}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

function AudiogramPreview({
  url,
  posterUrl,
  aspect,
  readOnly,
  disabled,
  onRegenerate,
}: {
  url: string;
  posterUrl: string | null;
  aspect: string | null;
  readOnly: boolean;
  disabled: boolean;
  onRegenerate: () => void;
}) {
  const aspectClass = aspect === "1:1" ? "aspect-square" : "aspect-[9/16]";
  return (
    <div className="flex flex-col gap-2">
      <div className={`bg-surface-3 relative ${aspectClass} w-full overflow-hidden rounded-lg`}>
        <video
          className="h-full w-full object-cover"
          src={url}
          poster={posterUrl ?? undefined}
          controls
          preload="metadata"
        />
      </div>
      <div className="flex items-center gap-3">
        <a
          className="text-accent text-[12.5px] font-semibold hover:underline"
          href={url}
          download
          target="_blank"
          rel="noreferrer"
        >
          Download
        </a>
        {!readOnly && (
          <button
            type="button"
            className="text-muted text-[12.5px] font-semibold hover:underline disabled:opacity-60"
            onClick={onRegenerate}
            disabled={disabled}
          >
            Regenerate
          </button>
        )}
      </div>
    </div>
  );
}

function AudiogramStatusPill({ status }: { status: ClipRenderStatus | null }) {
  if (status === null) {
    return (
      <span
        className="rounded-pill inline-flex items-center gap-[5px] px-[9px] py-[3px] font-sans text-[11px] font-semibold"
        style={{ background: "#F5F6F8", color: "#7B8496" }}
      >
        <span className="block h-[6px] w-[6px] rounded-full" style={{ background: "#7B8496" }} />
        None
      </span>
    );
  }
  const meta: Record<ClipRenderStatus, { label: string; bg: string; color: string }> = {
    [ClipRenderStatus.PENDING]: { label: "Queued", bg: "#EEF2F7", color: "#525F76" },
    [ClipRenderStatus.RENDERING]: { label: "Rendering", bg: "#FEF6E7", color: "#8A5A00" },
    [ClipRenderStatus.READY]: { label: "Ready", bg: "#E7F4EC", color: "#1E7A47" },
    [ClipRenderStatus.FAILED]: { label: "Failed", bg: "#FCE8E8", color: "#B42318" },
  };
  const m = meta[status];
  return (
    <span
      className="rounded-pill inline-flex items-center gap-[5px] px-[9px] py-[3px] font-sans text-[11px] font-semibold"
      style={{ background: m.bg, color: m.color }}
    >
      <span className="block h-[6px] w-[6px] rounded-full" style={{ background: m.color }} />
      {m.label}
    </span>
  );
}
