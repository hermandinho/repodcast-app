"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { signArtworkUploadAction } from "@/app/(dashboard)/clients/artwork-actions";

/**
 * Direct-to-R2 artwork uploader. Renders an "Upload artwork" button + a
 * small thumbnail preview when `value` is set. PUTs the file straight to
 * R2 via a pre-signed URL — the browser never proxies the bytes through
 * our server.
 */
export function ArtworkUpload({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
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
    setProgress(0);
    startTransition(async () => {
      try {
        const signed = await signArtworkUploadAction({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
        });
        if (!signed.ok) {
          setError(signed.error);
          setProgress(null);
          return;
        }
        // Stream with XHR so we can show progress (fetch streams don't
        // surface uploaded-byte counts in the browser).
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
          // xhr.onerror fires for low-level failures — the response never
          // reaches us. Almost always a CORS preflight rejection from R2
          // (bucket needs a CORS policy permitting this origin). Run
          // `npm run r2:cors` to apply one.
          xhr.onerror = () =>
            reject(
              new Error(
                "Upload blocked before reaching R2 — likely a CORS preflight rejection. Run `npm run r2:cors` to allow this origin on the bucket.",
              ),
            );
          xhr.send(file);
        });
        onChange(signed.data.publicUrl);
        setProgress(100);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
        setProgress(null);
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt="Artwork preview"
            className="h-12 w-12 flex-shrink-0 rounded-md object-cover"
            style={{ background: "#EEF1F6" }}
          />
        ) : (
          <div
            className="font-display text-muted-2 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md text-[18px] font-semibold"
            style={{ background: "#EEF1F6" }}
          >
            ?
          </div>
        )}
        <Button type="button" variant="secondary" size="sm" onClick={pickFile} disabled={pending}>
          {pending
            ? progress != null
              ? `Uploading ${progress}%`
              : "Signing…"
            : value
              ? "Replace artwork"
              : "Upload artwork"}
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange("")}
            disabled={pending}
          >
            Clear
          </Button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          // Reset so picking the same filename again still fires.
          e.target.value = "";
        }}
      />

      {error && <div className="text-[12px] text-[#A06D12]">{error}</div>}
    </div>
  );
}
