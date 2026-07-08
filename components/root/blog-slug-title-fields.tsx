"use client";

import { useState } from "react";
import { slugify } from "@/lib/blog";

/**
 * Title + slug inputs that auto-sync the slug from the title on NEW posts.
 * Editing an existing post never auto-syncs — the slug is the public URL, and
 * silently rewriting it as the author renames the post would 404 every
 * inbound link. Once the user manually edits the slug field, the auto-sync
 * stops for the rest of the session (even on new posts) so their typing
 * isn't clobbered on the next keystroke.
 */
export function BlogSlugTitleFields({
  initialTitle,
  initialSlug,
  disabled,
}: {
  initialTitle: string;
  initialSlug: string;
  disabled?: boolean;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [slug, setSlug] = useState(initialSlug);
  // Auto-sync only when the slug started empty (new post). Any manual slug
  // edit flips this off. Renames on existing posts stay explicit.
  const [autoSync, setAutoSync] = useState(initialSlug.length === 0);

  const handleTitle = (value: string) => {
    setTitle(value);
    if (autoSync) setSlug(slugify(value));
  };

  const handleSlug = (value: string) => {
    setSlug(value);
    setAutoSync(false);
  };

  return (
    <>
      <Field label="Title" hint="Public H1 + fallback <title>.">
        <input
          name="title"
          required
          maxLength={180}
          value={title}
          onChange={(e) => handleTitle(e.target.value)}
          className={inputCls}
          disabled={disabled}
        />
      </Field>

      <Field
        label="Slug"
        hint={
          autoSync
            ? "Kebab-case; lands at /blog/<slug>. Auto-syncing from title — edit to override."
            : "Kebab-case; lands at /blog/<slug>."
        }
      >
        <input
          name="slug"
          required
          maxLength={96}
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          value={slug}
          onChange={(e) => handleSlug(e.target.value)}
          className={inputCls + " font-mono"}
          disabled={disabled}
        />
      </Field>
    </>
  );
}

// Mirrors the shared field styling in `blog-post-form.tsx`. Duplicated here
// rather than exported from the server component so this file stays a leaf
// client module.
const inputCls =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 disabled:cursor-not-allowed disabled:opacity-60";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-zinc-200">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-zinc-500">{hint}</span> : null}
    </label>
  );
}
