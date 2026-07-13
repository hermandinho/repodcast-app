"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  finalizeSourceVideoUploadAction,
  signSourceVideoUploadAction,
} from "@/app/(dashboard)/episodes/[id]/actions";
import { Button } from "@/components/ui/button";

/**
 * Q1 wk10 — attach an alternate source video to an existing episode.
 * Bypasses the audio-transcribe path: the episode's transcript
 * already exists, we're just providing video the clip pipeline can
 * cut against.
 *
 * Three-step handshake:
 *   1. Server signs an R2 PUT URL scoped to the episode + agency
 *      (signSourceVideoUploadAction).
 *   2. Browser PUTs the file directly to R2 (no backend hop — bytes
 *      never touch the app server).
 *   3. Server stamps the resulting R2 key onto Episode.sourceVideoUrl
 *      (finalizeSourceVideoUploadAction).
 *
 * On success we call the caller's onAttached() so the parent can
 * refresh state and re-enable Generate/Retry.
 */

const ACCEPT = ".mp4,.mov,.webm,.mkv,video/mp4,video/quicktime,video/webm,video/x-matroska";

export function AttachSourceVideo({
  episodeId,
  variant = "primary",
  label = "Attach a source video",
  onAttached,
}: {
  episodeId: string;
  variant?: "primary" | "secondary";
  label?: string;
  onAttached?: () => void;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "signing" | "uploading" | "finalizing">("idle");
  const [error, setError] = useState<string | null>(null);

  const pick = () => fileRef.current?.click();

  const upload = async (file: File) => {
    setError(null);
    setProgress(0);
    setBusy(true);
    try {
      setStatus("signing");
      const signRes = await signSourceVideoUploadAction({
        episodeId,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
      });
      if (!signRes.ok) throw new Error(signRes.error);
      const { uploadUrl, objectKey } = signRes.data;

      setStatus("uploading");
      await putWithProgress(uploadUrl, file, setProgress);

      setStatus("finalizing");
      const finalize = await finalizeSourceVideoUploadAction({ episodeId, objectKey });
      if (!finalize.ok) throw new Error(finalize.error);

      router.refresh();
      onAttached?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setStatus("idle");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const statusLabel =
    status === "signing"
      ? "Preparing upload…"
      : status === "uploading"
        ? `Uploading… ${progress}%`
        : status === "finalizing"
          ? "Finalising…"
          : busy
            ? "Working…"
            : label;

  return (
    <div className="flex flex-col items-start gap-2">
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <Button variant={variant} onClick={pick} disabled={busy}>
        {statusLabel}
      </Button>
      {status === "uploading" && (
        <div className="bg-surface-3 h-1.5 w-full max-w-[280px] overflow-hidden rounded">
          <div
            className="bg-accent h-full transition-[width] duration-150"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      {error && <p className="text-danger text-[12.5px]">{error}</p>}
    </div>
  );
}

/**
 * XHR-based PUT so we can surface progress. `fetch()` doesn't expose an
 * upload progress event without the newer Streams API, which R2 doesn't
 * always play nicely with — XHR is the interoperable choice.
 */
function putWithProgress(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`R2 upload failed: ${xhr.status} ${xhr.statusText}`));
    };
    xhr.onerror = () => reject(new Error("R2 upload failed (network error)"));
    xhr.send(file);
  });
}
