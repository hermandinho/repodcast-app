"use client";

import { useMemo, useState } from "react";
import { retrimClipAction } from "@/app/(dashboard)/episodes/[id]/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";

/**
 * Q1 wk6 — trim editor. Number-input MVP; the waveform scrubber is
 * deferred to wk7+ (Q1.md).
 *
 * Inputs are MM:SS or MM:SS.mmm; we parse to milliseconds before firing
 * the action. Client-side validation surfaces span-range errors before
 * the RTT; the server action re-checks (defence in depth) and returns
 * actionable strings on failure.
 */

const MIN_SPAN_MS = 15_000;
const MAX_SPAN_MS = 90_000;

type Props = {
  open: boolean;
  onClose: () => void;
  clip: {
    id: string;
    episodeId: string;
    startMs: number;
    endMs: number;
  };
  onSubmitted: () => void;
};

export function TrimClipModal({ open, onClose, clip, onSubmitted }: Props) {
  // Fresh state each mount — the parent keys us on clip.id so switching
  // between clips remounts this component instead of leaking prior inputs.
  const [startInput, setStartInput] = useState(() => formatMsInput(clip.startMs));
  const [endInput, setEndInput] = useState(() => formatMsInput(clip.endMs));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedStart = useMemo(() => parseMsInput(startInput), [startInput]);
  const parsedEnd = useMemo(() => parseMsInput(endInput), [endInput]);

  const clientError = useMemo(() => {
    if (parsedStart === null) return "Start time is invalid — use MM:SS or MM:SS.mmm.";
    if (parsedEnd === null) return "End time is invalid — use MM:SS or MM:SS.mmm.";
    if (parsedEnd <= parsedStart) return "End time must be after start time.";
    const span = parsedEnd - parsedStart;
    if (span < MIN_SPAN_MS) return `Clip is too short — minimum ${MIN_SPAN_MS / 1000}s.`;
    if (span > MAX_SPAN_MS) return `Clip is too long — maximum ${MAX_SPAN_MS / 1000}s.`;
    return null;
  }, [parsedStart, parsedEnd]);

  const noChange =
    parsedStart !== null &&
    parsedEnd !== null &&
    parsedStart === clip.startMs &&
    parsedEnd === clip.endMs;

  const disabled = busy || clientError !== null || noChange;

  const onSubmit = async () => {
    if (clientError || parsedStart === null || parsedEnd === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await retrimClipAction({
        clipId: clip.id,
        episodeId: clip.episodeId,
        startMs: parsedStart,
        endMs: parsedEnd,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSubmitted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} ariaLabel="Trim clip">
      <ModalHeader
        title="Trim clip"
        description="Adjust the start and end and re-render. Span must be between 15 and 90 seconds."
        onClose={onClose}
      />
      <ModalBody>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit();
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <label className="text-muted text-[12.5px] font-semibold" htmlFor="trim-start">
              Start
            </label>
            <Input
              id="trim-start"
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
              placeholder="MM:SS"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-muted text-[12.5px] font-semibold" htmlFor="trim-end">
              End
            </label>
            <Input
              id="trim-end"
              value={endInput}
              onChange={(e) => setEndInput(e.target.value)}
              placeholder="MM:SS"
            />
          </div>
          <div className="text-muted-2 text-[12px]">
            Original: {formatMsInput(clip.startMs)} → {formatMsInput(clip.endMs)}
            {" ("}
            {((clip.endMs - clip.startMs) / 1000).toFixed(1)}s{")"}
          </div>
          {clientError && <p className="text-danger text-[12.5px]">{clientError}</p>}
          {error && <p className="text-danger text-[12.5px]">{error}</p>}
        </form>
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onSubmit} disabled={disabled}>
          {busy ? "Re-rendering…" : "Re-render"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Timecode helpers — exported for tests
// ---------------------------------------------------------------------------

export function formatMsInput(ms: number): string {
  const totalMs = Math.max(0, Math.floor(ms));
  const totalSec = Math.floor(totalMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const millis = totalMs % 1000;
  const pad2 = (n: number) => n.toString().padStart(2, "0");
  const pad3 = (n: number) => n.toString().padStart(3, "0");
  return millis === 0 ? `${m}:${pad2(s)}` : `${m}:${pad2(s)}.${pad3(millis)}`;
}

/**
 * Parse "MM:SS", "M:SS", "MM:SS.mmm", or "MM:SS.m" to ms. Returns null on
 * any garbage. Also accepts a bare integer as seconds ("42" → 42_000).
 */
export function parseMsInput(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  // Bare integer seconds.
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  const match = /^(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?$/.exec(trimmed);
  if (!match) return null;
  const [, mm, ss, msPart] = match;
  const minutes = Number(mm);
  const seconds = Number(ss);
  if (seconds > 59) return null;
  let millis = 0;
  if (msPart !== undefined) {
    // Pad to 3 digits so "0:30.5" → 500 ms, not 5 ms.
    millis = Number(msPart.padEnd(3, "0"));
  }
  return minutes * 60_000 + seconds * 1000 + millis;
}
