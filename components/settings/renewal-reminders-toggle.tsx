"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateRenewalRemindersAction } from "@/app/(dashboard)/settings/agency/actions";

/**
 * Phase 2.13.6 — one-checkbox affordance for the renewals-reminder cron's
 * mute switch. Optimistic local state; rolls back on action failure.
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
    // Optimistic flip — rollback on error so the UI doesn't lie about
    // the persisted state.
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
        // Keep server-rendered surfaces (the agency settings page itself)
        // in sync with the new value.
        router.refresh();
      } catch (err) {
        setEnabled(!next);
        setError(err instanceof Error ? err.message : "Toggle failed.");
      }
    });
  };

  const stateLabel = enabled ? "On" : "Off";
  const stateColor = enabled ? "#1E7A47" : "#8B95A6";

  return (
    <div className="border-border-subtle bg-surface-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4">
      <div>
        <div className="text-ink font-sans text-[13px] font-semibold">Renewals cron</div>
        <div className="text-muted-2 mt-[2px] text-[12px]">
          {enabled
            ? "We'll email you 30 days and 7 days before each renewal."
            : "Muted. We won't email about upcoming renewals."}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="font-sans text-[12.5px] font-semibold" style={{ color: stateColor }}>
          {stateLabel}
        </span>
        <button
          type="button"
          onClick={onToggle}
          disabled={!canEdit || pending}
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle renewal reminders"
          className="relative inline-flex h-[24px] w-[44px] flex-shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            background: enabled ? "var(--color-accent)" : "#C9D4E8",
          }}
        >
          <span
            className="inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow-sm transition-transform"
            style={{
              transform: enabled ? "translateX(23px)" : "translateX(3px)",
            }}
          />
        </button>
      </div>

      {error && (
        <div className="basis-full rounded-md bg-[#FBEDEC] px-3 py-2 font-sans text-[12px] font-medium text-[#8A2A1F]">
          {error}
        </div>
      )}
      {!canEdit && (
        <div className="text-muted-2 basis-full font-sans text-[11.5px]">
          Only owners and admins can change this setting.
        </div>
      )}
    </div>
  );
}
