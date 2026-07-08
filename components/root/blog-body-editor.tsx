"use client";

import { useRef, useState, useTransition } from "react";
import { signBlogImageUploadAction } from "@/app/(root)/root/blog/actions";

/**
 * Body-Markdown editor with inline image insert.
 *
 * The textarea itself is uncontrolled — it defaults to the post's saved
 * body, and the form's normal `FormData` pickup submits whatever the user
 * ended up typing. The ref exists so the "Insert image" button can splice
 * a Markdown image reference at the current cursor position instead of
 * appending blindly to the end (which would be maddening on a long post).
 *
 * Upload path reuses `signBlogImageUploadAction` from the same admin
 * surface as the Cover / OG image fields, so R2 config prereqs are
 * identical.
 */
export function BlogBodyEditor({
  name,
  initialValue,
  disabled,
}: {
  name: string;
  initialValue: string;
  disabled?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const insertAtCursor = (snippet: string) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    // Sandwich the snippet with newlines when it doesn't already sit on its
    // own line — Markdown images inside a paragraph render inline, which is
    // almost never what the author wants for a body illustration.
    const leadingNl =
      before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const trailingNl = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
    const next = before + leadingNl + snippet + trailingNl + after;
    el.value = next;
    const cursor = (before + leadingNl + snippet + trailingNl).length;
    el.selectionStart = el.selectionEnd = cursor;
    el.focus();
    // React's uncontrolled textarea doesn't fire onChange from a direct
    // `el.value = …` mutation, but we don't rely on onChange here — the
    // form submit reads the DOM value directly.
  };

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
        // `![]()` with an empty alt is technically valid but hostile to
        // accessibility + SEO. Derive a starter alt from the filename so
        // the author is nudged to write real alt text instead of leaving
        // the blank slot alone.
        const suggestedAlt = file.name
          .replace(/\.[^.]+$/, "")
          .replace(/[-_]+/g, " ")
          .trim();
        insertAtCursor(`![${suggestedAlt}](${signed.publicUrl})`);
        setProgress(100);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
        setProgress(null);
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={pickFile}
          disabled={disabled || pending}
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-[12.5px] font-medium text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? (progress != null ? `Uploading ${progress}%` : "Signing…") : "Insert image"}
        </button>
        <span className="text-[11px] text-zinc-500">
          Uploads to R2 and inserts a Markdown reference at the cursor.
        </span>
      </div>

      <textarea
        ref={textareaRef}
        name={name}
        required
        maxLength={60_000}
        rows={22}
        defaultValue={initialValue}
        disabled={disabled}
        className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-[12.5px] text-zinc-100 placeholder:text-zinc-500 disabled:cursor-not-allowed disabled:opacity-60"
      />

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
