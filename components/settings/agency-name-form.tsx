"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateAgencyAction } from "@/app/(dashboard)/settings/agency/actions";

const INK = "#0a1e3c";
const MUTED = "#41506b";
const LIGHT_MUTED = "#8a97ad";
const OUTLINE_STRONG = "#d4dbe7";
const ACCENT = "#3A5BA0";

/**
 * Inline agency-name input + save button. Deliberately skips its own
 * label/description — the settings/agency page wraps it in a
 * two-column card row where the left column carries the copy. Save is
 * disabled until the value differs from the persisted one and is a
 * non-empty trim ≤ 120 chars.
 */
export function AgencyNameForm({
  initial,
  canEdit,
}: {
  initial: string;
  /** Render read-only when the viewer isn't OWNER/ADMIN. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial);
  const [saved, setSaved] = useState<string>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 120;
  const dirty = trimmed !== saved.trim();

  const onSave = () => {
    if (!valid || !dirty) return;
    setError(null);
    setJustSaved(false);
    startTransition(async () => {
      try {
        const result = await updateAgencyAction({ name: trimmed });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSaved(result.data.name);
        setName(result.data.name);
        setJustSaved(true);
        router.refresh();
        setTimeout(() => setJustSaved(false), 1800);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save.");
      }
    });
  };

  if (!canEdit) {
    return (
      <div>
        <div style={{ fontSize: 14, color: MUTED }}>{saved}</div>
        <p style={{ fontSize: 11.5, color: LIGHT_MUTED, marginTop: 6 }}>
          Only owners and admins can rename the agency.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      className="flex flex-col"
      style={{ gap: 10 }}
    >
      <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
        <input
          id="agency-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Northbeam Studio"
          maxLength={120}
          aria-invalid={error ? true : undefined}
          aria-label="Agency name"
          style={{
            flex: 1,
            maxWidth: 340,
            border: `1px solid ${OUTLINE_STRONG}`,
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 14,
            color: INK,
            background: "#fff",
            fontFamily: "inherit",
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={!valid || !dirty || pending}
          style={{
            background: !valid || !dirty || pending ? "#f6f8fc" : ACCENT,
            color: !valid || !dirty || pending ? LIGHT_MUTED : "#fff",
            border: !valid || !dirty || pending ? `1px solid #e4e9f1` : "none",
            borderRadius: 8,
            padding: "9px 16px",
            fontWeight: 600,
            fontSize: 13,
            cursor: pending ? "wait" : !valid || !dirty ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            transition: "background-color 120ms",
          }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {dirty && !pending && (
          <button
            type="button"
            onClick={() => {
              setName(saved);
              setError(null);
            }}
            style={{
              fontSize: 12.5,
              fontWeight: 500,
              color: LIGHT_MUTED,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
        )}
        {justSaved && !dirty && (
          <span
            className="inline-flex items-center"
            style={{ gap: 5, fontSize: 12, fontWeight: 600, color: "#1E7A47" }}
            aria-live="polite"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M2.5 6.5l2.4 2.4L9.8 3.6" />
            </svg>
            Saved
          </span>
        )}
      </div>
      {error && (
        <div
          style={{
            background: "#FBF1DE",
            color: "#A06D12",
            fontSize: 12,
            fontWeight: 500,
            padding: "8px 12px",
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      )}
    </form>
  );
}
