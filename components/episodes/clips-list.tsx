"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipRenderStatus } from "@prisma/client";
import {
  deleteClipAction,
  regenerateClipsAction,
  requestClipsAction,
  retryClipAction,
} from "@/app/(dashboard)/episodes/[id]/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TrimClipModal } from "@/components/episodes/trim-clip-modal";
import { translateClipRenderError } from "@/lib/clip-error-messages";

/**
 * Client-side clips grid. Polls the current page every 5 s while any
 * clip is PENDING/RENDERING — cheaper than a dedicated SSE stream for
 * a view most agencies visit a handful of times per week.
 *
 * The polling is a plain `router.refresh()` (server component re-renders,
 * client state stays) — so the visible list reflects DB state each tick
 * without a full page reload.
 */

export type ClipRow = {
  id: string;
  startMs: number;
  endMs: number;
  score: number;
  hookLine: string;
  status: ClipRenderStatus;
  renderedUrl: string | null;
  posterUrl: string | null;
  renderError: string | null;
  createdAt: string;
};

type Props = {
  episodeId: string;
  clips: ClipRow[];
  isReady: boolean;
  notReadyReason: string | null;
  readOnly: boolean;
};

export function ClipsList({ episodeId, clips, isReady, notReadyReason, readOnly }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [trimClipId, setTrimClipId] = useState<string | null>(null);

  const inFlightCount = useMemo(
    () =>
      clips.filter(
        (c) => c.status === ClipRenderStatus.PENDING || c.status === ClipRenderStatus.RENDERING,
      ).length,
    [clips],
  );

  // Poll while anything is in flight.
  useEffect(() => {
    if (inFlightCount === 0) return;
    const t = setInterval(() => router.refresh(), 5_000);
    return () => clearInterval(t);
  }, [inFlightCount, router]);

  const runAction = (fn: () => Promise<{ ok: true } | { ok: false; error: string } | void>) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (result && "ok" in result && !result.ok) {
          setError(result.error);
        } else {
          router.refresh();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  };

  const onGenerate = () => runAction(async () => requestClipsAction({ episodeId }));

  const onRegenerate = () => {
    if (
      !confirm(
        `Regenerate clips? This deletes ${clips.length} existing clip${clips.length === 1 ? "" : "s"} and starts fresh.`,
      )
    ) {
      return;
    }
    runAction(async () => regenerateClipsAction({ episodeId }));
  };

  const onDelete = (clipId: string) => {
    if (!confirm("Delete this clip?")) return;
    runAction(async () => deleteClipAction({ clipId, episodeId }));
  };

  const onRetry = (clipId: string) => {
    runAction(async () => retryClipAction({ clipId, episodeId }));
  };

  // ---- Not-ready state ----
  if (!isReady) {
    return (
      <Card className="p-6">
        <div className="font-display text-ink text-[15px] font-semibold">
          Not ready for clip generation
        </div>
        <p className="text-muted-2 mt-1.5 text-[13px] leading-[1.6]">
          {notReadyReason ?? "This episode isn't ready yet."}
        </p>
      </Card>
    );
  }

  // ---- Empty state ----
  if (clips.length === 0) {
    return (
      <Card className="p-8 text-center">
        <div className="font-display text-ink text-[16px] font-semibold">No clips yet</div>
        <p className="text-muted-2 mx-auto mt-1.5 max-w-md text-[13px] leading-[1.6]">
          We&apos;ll ask Claude to pick the strongest moments and render up to five vertical clips.
          Takes about a minute per clip.
        </p>
        {!readOnly && (
          <Button className="mt-5" variant="primary" onClick={onGenerate} disabled={isPending}>
            {isPending ? "Starting…" : "Generate clips"}
          </Button>
        )}
        {error && <p className="text-danger mt-3 text-[12.5px]">{error}</p>}
      </Card>
    );
  }

  // ---- Populated grid ----
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-muted-2 text-[13px]">
          {clips.length} clip{clips.length === 1 ? "" : "s"}
          {inFlightCount > 0 && <> · {inFlightCount} rendering</>}
        </div>
        {!readOnly && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onRegenerate}
            disabled={isPending || inFlightCount > 0}
            title={inFlightCount > 0 ? "Wait for current renders to finish" : undefined}
          >
            {isPending ? "…" : "Regenerate all"}
          </Button>
        )}
      </div>
      {error && (
        <div className="border-danger/40 bg-danger/5 text-danger mb-4 rounded-lg border p-3 text-[12.5px]">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clips.map((clip) => (
          <ClipCard
            key={clip.id}
            clip={clip}
            readOnly={readOnly}
            onDelete={() => onDelete(clip.id)}
            onTrim={() => setTrimClipId(clip.id)}
            onRetry={() => onRetry(clip.id)}
          />
        ))}
      </div>
      {trimClipId !== null &&
        (() => {
          const clip = clips.find((c) => c.id === trimClipId);
          if (!clip) return null;
          return (
            <TrimClipModal
              // Remount when the target clip changes so useState re-initialises
              // from props without an in-effect reset.
              key={clip.id}
              open
              onClose={() => setTrimClipId(null)}
              clip={{
                id: clip.id,
                episodeId,
                startMs: clip.startMs,
                endMs: clip.endMs,
              }}
              onSubmitted={() => router.refresh()}
            />
          );
        })()}
    </div>
  );
}

function ClipCard({
  clip,
  readOnly,
  onDelete,
  onTrim,
  onRetry,
}: {
  clip: ClipRow;
  readOnly: boolean;
  onDelete: () => void;
  onTrim: () => void;
  onRetry: () => void;
}) {
  const spanSec = (clip.endMs - clip.startMs) / 1000;
  const status = clip.status;
  const errorTranslation =
    status === ClipRenderStatus.FAILED ? translateClipRenderError(clip.renderError) : null;

  return (
    <Card className="overflow-hidden">
      <ClipMedia clip={clip} />
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <ClipStatusPill status={status} />
          <span className="text-muted-2 font-sans text-[11.5px]">
            {spanSec.toFixed(0)}s · score {clip.score.toFixed(2)}
          </span>
        </div>
        <p className="text-ink text-[13px] leading-[1.5]">{clip.hookLine}</p>
        {errorTranslation && (
          <div className="mt-2 flex flex-col gap-1" title={errorTranslation.raw}>
            <p className="text-danger text-[11.5px] leading-[1.4] font-semibold">
              {errorTranslation.friendly}
            </p>
            {errorTranslation.hint && (
              <p className="text-muted-2 text-[11px] leading-[1.4]">{errorTranslation.hint}</p>
            )}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {status === ClipRenderStatus.READY && clip.renderedUrl && (
            <a
              className="text-accent text-[12.5px] font-semibold hover:underline"
              href={clip.renderedUrl}
              target="_blank"
              rel="noreferrer"
              download
            >
              Download
            </a>
          )}
          {status === ClipRenderStatus.READY && clip.renderedUrl && (
            <button
              type="button"
              className="text-muted text-[12.5px] font-semibold hover:underline"
              onClick={() => {
                if (clip.renderedUrl) navigator.clipboard.writeText(clip.renderedUrl);
              }}
            >
              Copy link
            </button>
          )}
          {status === ClipRenderStatus.READY && clip.posterUrl && (
            <a
              className="text-muted text-[12.5px] font-semibold hover:underline"
              href={clip.posterUrl}
              target="_blank"
              rel="noreferrer"
              download
            >
              Poster
            </a>
          )}
          {!readOnly && status === ClipRenderStatus.FAILED && (
            <button
              type="button"
              className="text-accent text-[12.5px] font-semibold hover:underline"
              onClick={onRetry}
            >
              Retry
            </button>
          )}
          {!readOnly &&
            status !== ClipRenderStatus.PENDING &&
            status !== ClipRenderStatus.RENDERING && (
              <button
                type="button"
                className="text-muted text-[12.5px] font-semibold hover:underline"
                onClick={onTrim}
              >
                Trim
              </button>
            )}
          {!readOnly && (
            <button
              type="button"
              className="text-muted-2 ml-auto text-[12px] hover:underline"
              onClick={onDelete}
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

function ClipMedia({ clip }: { clip: ClipRow }) {
  const posterOnly = clip.posterUrl && !clip.renderedUrl;
  const ready = clip.renderedUrl && clip.status === ClipRenderStatus.READY;

  return (
    <div className="bg-surface-3 relative aspect-[9/16] w-full overflow-hidden">
      {ready ? (
        <video
          className="h-full w-full object-cover"
          src={clip.renderedUrl!}
          poster={clip.posterUrl ?? undefined}
          controls
          preload="metadata"
        />
      ) : posterOnly ? (
        <img className="h-full w-full object-cover opacity-70" src={clip.posterUrl!} alt="" />
      ) : (
        <ClipMediaPlaceholder status={clip.status} />
      )}
    </div>
  );
}

function ClipMediaPlaceholder({ status }: { status: ClipRenderStatus }) {
  const label =
    status === ClipRenderStatus.PENDING
      ? "Queued"
      : status === ClipRenderStatus.RENDERING
        ? "Rendering…"
        : status === ClipRenderStatus.FAILED
          ? "Failed"
          : "Waiting";
  const isSpinning = status === ClipRenderStatus.PENDING || status === ClipRenderStatus.RENDERING;
  return (
    <div className="text-muted-2 flex h-full w-full flex-col items-center justify-center gap-2 text-[12.5px]">
      {isSpinning && (
        <div className="border-muted/30 border-t-accent h-5 w-5 animate-spin rounded-full border-2" />
      )}
      <span>{label}</span>
    </div>
  );
}

function ClipStatusPill({ status }: { status: ClipRenderStatus }) {
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
