"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateAgencyAction } from "@/app/(dashboard)/settings/agency/actions";

/**
 * Inline edit for the agency display name. Save is disabled until the value
 * differs from the persisted one and is a non-empty trim ≤ 120 chars.
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
        // Drop the success cue after a moment so it doesn't linger.
        setTimeout(() => setJustSaved(false), 1800);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save.");
      }
    });
  };

  if (!canEdit) {
    return (
      <div>
        <div className="text-ink font-sans text-[12.5px] font-semibold">Agency name</div>
        <div className="text-muted mt-2 text-[14px]">{saved}</div>
        <p className="text-muted-2 mt-[6px] text-[11.5px]">
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
      className="flex flex-col gap-2"
    >
      <label htmlFor="agency-name" className="text-ink font-sans text-[12.5px] font-semibold">
        Agency name
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="agency-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Northbeam Studio"
          maxLength={120}
          className="sm:max-w-[340px]"
          aria-invalid={error ? true : undefined}
        />
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" disabled={!valid || !dirty || pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          {dirty && !pending && (
            <button
              type="button"
              onClick={() => {
                setName(saved);
                setError(null);
              }}
              className="text-muted-2 hover:text-ink font-sans text-[12.5px] font-medium"
            >
              Cancel
            </button>
          )}
          {justSaved && !dirty && (
            <span
              className="inline-flex items-center gap-[5px] font-sans text-[12px] font-semibold text-[#1E7A47]"
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
      </div>
      <p className="text-muted-2 text-[11.5px]">
        Shown on the topbar, dashboard greeting, and outgoing invite + welcome emails.
      </p>
      {error && (
        <div className="rounded-md bg-[#FBF1DE] px-3 py-2 font-sans text-[12px] font-medium text-[#A06D12]">
          {error}
        </div>
      )}
    </form>
  );
}
