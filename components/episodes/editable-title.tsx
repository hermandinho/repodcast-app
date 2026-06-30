"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateEpisodeTitleAction } from "@/app/(dashboard)/episodes/[id]/actions";

/**
 * Click-to-edit episode title. Hovering shows a subtle pencil glyph;
 * clicking flips to an inline `<input>`. Enter saves, Escape cancels,
 * blur cancels (so a mis-click outside the input doesn't auto-save a
 * partial edit — Enter is the explicit commit).
 *
 * The action is a no-op in sample-data mode, so this also works on a
 * fresh clone without DB; the change is visible until the next refresh.
 */
export function EditableTitle({
  episodeId,
  initial,
  className,
}: {
  episodeId: string;
  initial: string;
  className?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [value, setValue] = useState(initial);
  const [pending, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep the displayed value in sync if the parent re-renders with a new
  // initial (e.g. after router.refresh). This is the rule's documented
  // exception — syncing local state to an external identity change is the
  // legitimate use case for setState-in-effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!editing) setValue(initial);
  }, [initial, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const cancel = () => {
    setEditing(false);
    setDraft(value);
    setError(null);
  };

  const save = () => {
    const next = draft.trim();
    if (next.length === 0) {
      setError("Title can't be empty.");
      return;
    }
    if (next === value) {
      setEditing(false);
      return;
    }
    setError(null);
    startSave(async () => {
      try {
        const result = await updateEpisodeTitleAction({ episodeId, title: next });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setValue(result.data.title);
        setEditing(false);
        // Sync surrounding RSC (breadcrumb, /episodes index, etc.).
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save title.");
      }
    });
  };

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={cancel}
          disabled={pending}
          maxLength={240}
          className={`font-display text-ink w-full rounded-[8px] px-[10px] py-[4px] outline-none ${className ?? ""}`}
          style={{
            border: "1.5px solid var(--color-accent)",
            background: "#FBFCFE",
            // Match the surrounding h1 metrics so the swap doesn't jump.
            fontSize: "27px",
            lineHeight: 1.18,
            letterSpacing: "-0.5px",
            fontWeight: 600,
          }}
        />
        {error && <span className="text-[12px] text-[#A06D12]">{error}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className={`group hover:bg-canvas focus:bg-canvas -mx-[10px] -my-[2px] flex items-center gap-[10px] rounded-[8px] px-[10px] py-[2px] text-left transition-colors ${className ?? ""}`}
      title="Click to rename"
    >
      <h1 className="font-display text-ink text-[27px] leading-[1.18] font-semibold tracking-[-0.5px]">
        {value}
      </h1>
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        stroke="#8B95A6"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
        aria-hidden
      >
        <path d="M9.5 2.5l2 2-7 7H2.5v-2z" />
        <path d="M8.5 3.5l2 2" />
      </svg>
    </button>
  );
}
