"use client";

import { useRef, useState, useTransition } from "react";
import { ALLOWED_AUDIO_CONTENT_TYPES, MAX_AUDIO_UPLOAD_BYTES, formatAudioSize } from "@/lib/audio";
import { signAudioUploadAction } from "@/app/(dashboard)/episodes/new/audio-actions";

/**
 * Direct-to-R2 audio uploader for the New Episode wizard's audio path.
 * Mirrors <ArtworkUpload>'s pattern (sign → PUT via XHR for upload
 * progress → return the object key the parent stores). The audio object
 * stays private — only signed URLs are minted on demand from this key.
 *
 * `showId` is required so the sign action can place the upload under
 * `audio/<agencyId>/<showId>/<episodeId>.<ext>`. The action pre-mints the
 * episodeId server-side and returns it so the wizard can thread it back
 * into `createEpisodeAction` — keeping key ↔ row id consistent without a
 * rename round-trip.
 */
export type AudioUploadValue = {
  objectKey: string;
  episodeId: string;
  filename: string;
  size: number;
};

export function AudioUpload({
  showId,
  value,
  onChange,
}: {
  /** The Show this episode belongs to — required so the R2 key can embed it. */
  showId: string;
  value: AudioUploadValue | null;
  onChange: (next: AudioUploadValue | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

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
        const signed = await signAudioUploadAction({
          showId,
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
          // Almost always a CORS preflight rejection — same mode as the
          // artwork uploader.
          xhr.onerror = () =>
            reject(
              new Error(
                "Upload blocked before reaching R2 — likely a CORS preflight rejection. Run `npm run r2:cors` to allow this origin on the bucket.",
              ),
            );
          xhr.send(file);
        });
        setProgress(100);
        onChange({
          objectKey: signed.data.objectKey,
          episodeId: signed.data.episodeId,
          filename: file.name,
          size: file.size,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
        setProgress(null);
      }
    });
  };

  if (value) {
    return (
      <div
        className="flex items-center gap-3 rounded-xl bg-[#FBFCFE] p-[14px]"
        style={{ border: "1.5px solid #BFE3CD" }}
      >
        <span
          className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[10px]"
          style={{ background: "#E7F4EC" }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="#1E7A47"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 12.5l3-3 3 3 5-5" />
            <path d="M14 4.5h2.5V7" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-ink truncate font-sans text-[13.5px] font-semibold">
            {value.filename}
          </div>
          <div className="text-muted-2 mt-[2px] text-[12px]">
            {formatAudioSize(value.size)} · uploaded · ready to transcribe
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setProgress(null);
          }}
          disabled={pending}
          className="text-muted-2 hover:text-ink hover:bg-canvas rounded-md px-[10px] py-[7px] font-sans text-[12.5px] font-medium transition-colors disabled:opacity-50"
        >
          Replace
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        ref={dropRef}
        onDragOver={(e) => {
          e.preventDefault();
          if (!isDragging) setIsDragging(true);
        }}
        onDragLeave={(e) => {
          // Only un-drag when leaving the dropzone itself, not children.
          if (e.target === dropRef.current) setIsDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        className="rounded-xl bg-[#FBFCFE] p-[34px] text-center transition-colors"
        style={{
          border: `1.5px dashed ${isDragging ? "#2E9E5B" : "#C9D4E8"}`,
          background: isDragging ? "#F1FAF5" : "#FBFCFE",
        }}
      >
        <div className="mx-auto mb-[14px] flex h-[46px] w-[46px] items-center justify-center rounded-xl bg-[#E7F4EC]">
          <svg
            width="22"
            height="22"
            viewBox="0 0 22 22"
            fill="none"
            stroke="#1E7A47"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 14V4M7 7.5L11 3.5l4 4M4 14v3a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 18 17v-3" />
          </svg>
        </div>
        {progress != null ? (
          <>
            <div className="text-ink mb-[5px] font-sans text-[14px] font-semibold">
              {progress < 100 ? `Uploading ${progress}%` : "Finishing up..."}
            </div>
            <div className="mx-auto mt-3 h-[6px] max-w-[260px] overflow-hidden rounded-md bg-[#EEF1F6]">
              <div
                className="h-full rounded-md bg-[#2E9E5B] transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={pickFile}
              disabled={pending}
              className="text-ink mb-[5px] font-sans text-[14px] font-semibold underline-offset-2 hover:underline disabled:opacity-50"
            >
              Drop an audio file or browse
            </button>
            <div className="text-muted-2 text-[12.5px]">
              MP3 / M4A / WAV / FLAC / OGG · up to {formatAudioSize(MAX_AUDIO_UPLOAD_BYTES)}
            </div>
          </>
        )}
      </div>

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

      {error && <div className="mt-[10px] text-center text-[12px] text-[#A06D12]">{error}</div>}
    </>
  );
}
