"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PlanLimitCapacity } from "@/components/billing/plan-limit-banner";
import { ShowFormModal, type ShowClientOption } from "./show-form-modal";

/**
 * Client-only wrapper that opens `<ShowFormModal mode="create">`. Accepts the
 * full client list as the picker source. If `defaultClientId` is set (or the
 * list has exactly one entry), the modal locks the picker so callers from a
 * client detail page can't accidentally re-parent.
 */
export function NewShowButton({
  clients,
  defaultClientId,
  capacity = null,
  variant = "primary",
  disabled,
  disabledHint,
}: {
  clients: ShowClientOption[];
  defaultClientId?: string;
  /** Current shows-vs-cap usage; renders the soft upgrade banner in-modal. */
  capacity?: PlanLimitCapacity | null;
  /** "primary" is the standard accent CTA; "inline" is a smaller link-style button for empty states. */
  variant?: "primary" | "inline";
  disabled?: boolean;
  disabledHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const isDisabled = disabled || clients.length === 0;
  const hint = disabledHint ?? (clients.length === 0 ? "Add a client first" : undefined);

  return (
    <>
      {variant === "primary" ? (
        <Button
          size="sm"
          onClick={() => setOpen(true)}
          disabled={isDisabled}
          title={isDisabled ? hint : undefined}
          leadingIcon={
            <svg
              width="13"
              height="13"
              viewBox="0 0 13 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M6.5 2.5v8M2.5 6.5h8" />
            </svg>
          }
        >
          Add show
        </Button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={isDisabled}
          title={isDisabled ? hint : undefined}
          className="text-accent disabled:text-muted-2 font-sans text-[12.5px] font-semibold transition-colors hover:underline disabled:cursor-not-allowed disabled:no-underline"
        >
          + Add the first one
        </button>
      )}

      <ShowFormModal
        mode="create"
        clients={clients}
        defaultClientId={defaultClientId}
        capacity={capacity}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
