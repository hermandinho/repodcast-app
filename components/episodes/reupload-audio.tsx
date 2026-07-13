"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  finalizeAudioReuploadAction,
  signAudioReuploadAction,
} from "@/app/(dashboard)/episodes/[id]/actions";
import { ALLOWED_AUDIO_CONTENT_TYPES, MAX_AUDIO_UPLOAD_BYTES, formatAudioSize } from "@/lib/audio";

/**
 * Audio re-attach for episodes whose `audioUrl` was cleared
 * by the (now-retired) tier-2 orphan-audio cleanup. Two-step
 * direct-to-R2 flow:
 *
 *   1. `signAudioReuploadAction` returns a 15-minute presigned PUT URL
 *      and the R2 object key (matches the original upload's shape:
 *      `audio/<agency>/<show>/<episode>.ext`).
 *   2. Browser PUTs the file directly to R2 with an XHR so we can show
 *      an upload-progress bar.
 *   3. `finalizeAudioReuploadAction` stamps `Episode.audioUrl` to the
 *      returned key + revalidates the audiograms + clips tabs.
 *
 * `router.refresh()` at the end brings the tab out of the "no audio"
 * gate so the Regenerate button works without a manual reload.
 */

type Variant = "primary" | "inline";

export function ReuploadAudio({
  episodeId,
  variant = "inline",
}: {
  episodeId: string;
  variant?: Variant;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickFile = () => {
    setError(null);
    inputRef.current?.click();
  };

  const onFile = (file: File) => {
    setError(null);
    if (file.size > MAX_AUDIO_UPLOAD_BYTES) {
      setError(
        `${formatAudioSize(file.size)} is over the ${formatAudioSize(MAX_AUDIO_UPLOAD_BYTES)} limit.`,
      );
      return;
    }
    setProgress(0);
    startTransition(async () => {
      try {
        const signed = await signAudioReuploadAction({
          episodeId,
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        });
        if (!signed.ok) {
          setError(signed.error);
          setProgress(null);
          return;
        }
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", signed.data.uploadUrl);
          xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
          xhr.upload.onprogress = (e) => {
            if (!e.lengthComputable) return;
            setProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`R2 returned ${xhr.status}: ${xhr.responseText}`));
          };
          xhr.onerror = () =>
            reject(
              new Error("Upload blocked before reaching R2 — likely a CORS preflight rejection."),
            );
          xhr.send(file);
        });
        setProgress(100);
        const finalized = await finalizeAudioReuploadAction({
          episodeId,
          objectKey: signed.data.objectKey,
        });
        if (!finalized.ok) {
          setError(finalized.error);
          setProgress(null);
          return;
        }
        setProgress(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
        setProgress(null);
      }
    });
  };

  const label =
    progress != null
      ? progress < 100
        ? `Uploading ${progress}%`
        : "Attaching…"
      : "Re-upload audio";

  return (
    <>
      <button
        type="button"
        onClick={pickFile}
        disabled={pending}
        className={
          variant === "primary"
            ? "border-border text-ink hover:bg-canvas shadow-card flex items-center gap-2 rounded-[10px] border bg-white px-4 py-[10px] font-sans text-[13px] font-semibold transition-colors disabled:opacity-60"
            : "text-accent border-accent/40 hover:bg-accent-soft rounded-md border bg-white px-[10px] py-[6px] font-sans text-[12.5px] font-semibold transition-colors disabled:opacity-60"
        }
      >
        {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_AUDIO_CONTENT_TYPES.join(",")}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      {error && (
        <span className="text-danger ml-2 text-[11.5px]" role="alert">
          {error}
        </span>
      )}
    </>
  );
}
