"use client";

import { useRef, useState, useTransition } from "react";
import { signBlogImageUploadAction } from "@/app/(root)/root/blog/actions";

/**
 * Blog image picker with two entry points:
 *   1. Type/paste an absolute URL directly (R2, Cloudinary, wherever).
 *   2. Upload a file — the browser PUTs it straight to R2 via a pre-signed
 *      URL and we get back the public URL, which we then plug into the
 *      same text input.
 *
 * The URL text input is the single source of truth submitted with the form
 * (via its `name` prop), so a server-only fallback still works when JS is
 * off — the admin just doesn't get the upload affordance.
 */
export function BlogImageField({
  name,
  initialValue,
  disabled,
  helpText,
}: {
  /** Form field name. Must match the schema key on `UpsertBlogPostInput`. */
  name: string;
  initialValue: string;
  disabled?: boolean;
  helpText?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const isImage =
    value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/");

  const pickFile = () => {
    setError(null);
    fileRef.current?.click();
  };

  const onFile = (file: File) => {
    setError(null);
    setProgress(0);
    startTransition(async () => {
      try {
        const signed = await signBlogImageUploadAction({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
        });
        if (!signed.ok) {
          setError(signed.error);
          setProgress(null);
          return;
        }
        // XHR gives us real upload-progress events; fetch doesn't yet.
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", signed.uploadUrl);
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
              new Error(
                "Upload blocked before reaching R2 — likely a CORS preflight rejection. Run `npm run r2:cors` to allow this origin on the bucket.",
              ),
            );
          xhr.send(file);
        });
        setValue(signed.publicUrl);
        setProgress(100);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
        setProgress(null);
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        {value && isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt=""
            className="h-16 w-24 flex-shrink-0 rounded-md border border-zinc-800 bg-zinc-950 object-cover"
          />
        ) : (
          <div className="flex h-16 w-24 flex-shrink-0 items-center justify-center rounded-md border border-dashed border-zinc-800 bg-zinc-900/40 font-mono text-[10px] text-zinc-600">
            no image
          </div>
        )}

        <div className="flex flex-1 flex-col gap-2">
          <input
            type="url"
            name={name}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={500}
            placeholder="Paste an image URL, or click Upload"
            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disabled || pending}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={pickFile}
              disabled={disabled || pending}
              className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-[12.5px] font-medium text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending
                ? progress != null
                  ? `Uploading ${progress}%`
                  : "Signing…"
                : value
                  ? "Replace"
                  : "Upload"}
            </button>
            {value ? (
              <button
                type="button"
                onClick={() => {
                  setValue("");
                  setError(null);
                  setProgress(null);
                }}
                disabled={disabled || pending}
                className="rounded-md border border-transparent px-3 py-1.5 text-[12.5px] text-zinc-500 hover:text-zinc-200"
              >
                Clear
              </button>
            ) : null}
            {helpText ? <span className="text-[11px] text-zinc-500">{helpText}</span> : null}
          </div>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = "";
        }}
      />

      {error ? (
        <div className="rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-[12px] text-amber-100">
          {error}
        </div>
      ) : null}
    </div>
  );
}
