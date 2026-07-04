"use client";

import { useState } from "react";
import { createWorkspaceAction } from "@/app/onboarding/workspace/actions";

const INK = "#0a1e3c";
const ACCENT = "#3A5BA0";
const MUTED = "#41506b";
const LIGHT_MUTED = "#8a97ad";
const OUTLINE_STRONG = "#d4dbe7";

/**
 * Workspace-naming form used inside step 1 of the revamp onboarding. Kept
 * intentionally minimal — a single Input + Continue button. Styling
 * mirrors the revamp system (Schibsted sans, `#3A5BA0` accent, 8px
 * radius bordered input) rather than the `<Input>` primitive so the
 * form reads as part of the marketing/onboarding surface, not the
 * dashboard chrome.
 */
export function WorkspaceForm({
  suggestedName,
  passthroughQs,
}: {
  suggestedName: string;
  passthroughQs?: string;
}) {
  const [name, setName] = useState(suggestedName);
  const disabled = name.trim().length === 0;

  return (
    <form
      action={createWorkspaceAction}
      className="flex flex-col"
      style={{ gap: 18, fontFamily: "var(--font-revamp-sans)" }}
    >
      <label className="flex flex-col" style={{ gap: 8 }}>
        <span
          style={{
            fontFamily: "var(--font-revamp-mono)",
            fontSize: 11,
            letterSpacing: "0.14em",
            color: LIGHT_MUTED,
            fontWeight: 600,
            textTransform: "uppercase",
          }}
        >
          Workspace name
        </span>
        <input
          name="agencyName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your studio"
          required
          minLength={1}
          maxLength={120}
          autoFocus
          style={{
            border: `1px solid ${OUTLINE_STRONG}`,
            borderRadius: 10,
            padding: "12px 14px",
            fontSize: 15,
            color: INK,
            background: "#fff",
            fontFamily: "inherit",
            outline: "none",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = ACCENT;
            e.currentTarget.style.boxShadow = `0 0 0 3px rgba(58,91,160,0.18)`;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = OUTLINE_STRONG;
            e.currentTarget.style.boxShadow = "none";
          }}
        />
        <span style={{ fontSize: 12, color: MUTED }}>
          Teammates and clients will see this. You can rename it any time.
        </span>
      </label>
      {passthroughQs ? <input type="hidden" name="passthroughQs" value={passthroughQs} /> : null}
      <button
        type="submit"
        disabled={disabled}
        style={{
          marginTop: 6,
          background: disabled ? "#a9b8d4" : ACCENT,
          color: "#fff",
          border: "none",
          borderRadius: 10,
          padding: "12px 20px",
          fontSize: 14,
          fontWeight: 600,
          cursor: disabled ? "not-allowed" : "pointer",
          fontFamily: "inherit",
          transition: "background-color 120ms",
        }}
      >
        Continue
      </button>
    </form>
  );
}
