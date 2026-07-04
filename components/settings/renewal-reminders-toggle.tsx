"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRenewalRemindersAction } from "@/app/(dashboard)/settings/agency/actions";

const INK = "#0a1e3c";
const LIGHT_MUTED = "#8a97ad";
const ACCENT = "#3A5BA0";

/**
 * Toggle switch for the renewals-reminder cron mute. Renders as a self-
 * contained row (title + subtitle + switch) — the settings/agency page
 * wraps it in the right column of a two-column card, so this component
 * does NOT provide its own outer card chrome. Optimistic local state
 * rolls back on failure so the UI doesn't lie about the persisted state.
 */
export function RenewalRemindersToggle({
  initialEnabled,
  canEdit,
}: {
  initialEnabled: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onToggle = () => {
    if (!canEdit) return;
    const next = !enabled;
    setEnabled(next);
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateRenewalRemindersAction({ enabled: next });
        if (!result.ok) {
          setEnabled(!next);
          setError(result.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setEnabled(!next);
        setError(err instanceof Error ? err.message : "Toggle failed.");
      }
    });
  };

  return (
    <div className="flex flex-col" style={{ gap: 8 }}>
      <div className="flex items-center justify-between" style={{ maxWidth: 420, gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: INK }}>
            30 &amp; 7 days before renewal
          </div>
          <div style={{ fontSize: 12.5, color: LIGHT_MUTED, marginTop: 2 }}>
            {enabled
              ? "Sent automatically per client contract"
              : "Muted — no renewal emails will fire"}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          disabled={!canEdit || pending}
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle renewal reminders"
          className="relative inline-flex flex-shrink-0 cursor-pointer items-center disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            width: 40,
            height: 23,
            borderRadius: 99,
            background: enabled ? ACCENT : "#C9D4E8",
            border: "none",
            transition: "background-color 120ms",
          }}
        >
          <span
            className="inline-block rounded-full bg-white shadow-sm"
            style={{
              width: 18,
              height: 18,
              transform: enabled ? "translateX(19.5px)" : "translateX(2.5px)",
              transition: "transform 120ms",
            }}
          />
        </button>
      </div>

      {error && (
        <div
          style={{
            background: "#FBEDEC",
            color: "#8A2A1F",
            fontSize: 12,
            fontWeight: 500,
            padding: "8px 12px",
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      )}
      {!canEdit && (
        <div style={{ fontSize: 11.5, color: LIGHT_MUTED }}>
          Only owners and admins can change this setting.
        </div>
      )}
    </div>
  );
}
