"use client";

import { useState, useTransition } from "react";
import { deleteWorkspaceAction } from "@/app/(dashboard)/settings/agency/actions";

/**
 * Danger-zone footer on `/settings/agency`. Two-step confirmation:
 * click "Delete workspace…" to reveal an inline form that requires the
 * user to type the workspace name verbatim. The delete button stays
 * disabled until the typed name matches.
 *
 * When the agency has an active Stripe subscription (paid or trialing)
 * the parent passes `hasActiveSubscription`; we replace the CTA with a
 * "Cancel subscription first" notice instead of the destructive path,
 * so the user never even gets to type the name.
 */
export function DeleteWorkspaceForm({
  agencyName,
  hasActiveSubscription,
}: {
  agencyName: string;
  hasActiveSubscription: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matches = typed.trim() === agencyName.trim();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteWorkspaceAction({ confirmName: typed });
        // On success the server action calls redirect("/") — this line
        // is only reached when the action returned an ActionResult.ok=false.
        if (result && result.ok === false) {
          setError(result.error);
        }
      } catch (err) {
        // NEXT_REDIRECT propagates through server actions; the client
        // router handles it. Anything else is a real error.
        if (err instanceof Error && err.message.includes("NEXT_REDIRECT")) return;
        setError(err instanceof Error ? err.message : "Delete failed.");
      }
    });
  };

  return (
    <div
      style={{
        border: "1px dashed #e4c5c5",
        background: "#fdf8f8",
        borderRadius: 12,
        padding: "18px 28px",
        marginTop: 16,
      }}
    >
      <div className="flex flex-wrap items-center justify-between" style={{ gap: 16 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#a13c3c" }}>Delete workspace</div>
          <div style={{ fontSize: 12.5, color: "#b98a8a", marginTop: 2 }}>
            Removes all clients, shows, episodes, and generated content. Also deletes your login.
            Irreversible.
          </div>
        </div>
        {!expanded ? (
          hasActiveSubscription ? (
            <span
              style={{
                fontSize: 12.5,
                color: "#a13c3c",
                fontWeight: 600,
                background: "#fff",
                border: "1px solid #e4c5c5",
                padding: "8px 14px",
                borderRadius: 8,
              }}
            >
              Cancel your subscription first
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#a13c3c",
                border: "1px solid #e4c5c5",
                padding: "8px 16px",
                borderRadius: 8,
                background: "#fff",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Delete workspace…
            </button>
          )
        ) : null}
      </div>

      {expanded ? (
        <form
          onSubmit={onSubmit}
          style={{
            marginTop: 16,
            borderTop: "1px solid #e4c5c5",
            paddingTop: 16,
          }}
        >
          <label
            style={{
              display: "block",
              fontSize: 12.5,
              color: "#8a4a4a",
              marginBottom: 8,
              lineHeight: 1.5,
            }}
          >
            Type the workspace name{" "}
            <span
              style={{
                fontFamily: "var(--font-revamp-mono)",
                fontWeight: 700,
                color: "#a13c3c",
              }}
            >
              {agencyName}
            </span>{" "}
            to confirm.
          </label>
          <div className="flex flex-wrap" style={{ gap: 10 }}>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={pending}
              autoComplete="off"
              autoFocus
              style={{
                flex: 1,
                minWidth: 220,
                fontSize: 13.5,
                padding: "9px 12px",
                borderRadius: 8,
                border: "1px solid #d4bcbc",
                background: "#fff",
                color: "#3a1e1e",
                fontFamily: "inherit",
                outline: "none",
              }}
              placeholder={agencyName}
            />
            <button
              type="submit"
              disabled={!matches || pending}
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#fff",
                border: "none",
                padding: "9px 16px",
                borderRadius: 8,
                background: !matches || pending ? "#d4a3a3" : "#a13c3c",
                cursor: !matches || pending ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              {pending ? "Deleting…" : "Delete permanently"}
            </button>
            <button
              type="button"
              onClick={() => {
                setExpanded(false);
                setTyped("");
                setError(null);
              }}
              disabled={pending}
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#8a4a4a",
                border: "1px solid #d4bcbc",
                padding: "9px 14px",
                borderRadius: 8,
                background: "#fff",
                cursor: pending ? "not-allowed" : "pointer",
                fontFamily: "inherit",
              }}
            >
              Cancel
            </button>
          </div>
          {error ? (
            <div
              style={{
                marginTop: 10,
                fontSize: 12.5,
                color: "#a13c3c",
                background: "#fff",
                border: "1px solid #e4c5c5",
                padding: "8px 12px",
                borderRadius: 8,
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
