"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Modal built on the native <dialog> element so we get free Escape-to-close,
 * focus-trap, and accessible semantics. The component is controlled — pass
 * `open` and `onClose`. Clicks on the backdrop also fire `onClose`.
 *
 * Wrap content with <ModalHeader> / <ModalBody> / <ModalFooter> for
 * consistent spacing. Backdrop styling lives in `app/globals.css`.
 */
export function Modal({
  open,
  onClose,
  children,
  className,
  ariaLabel,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  // Sync the controlled `open` prop with the dialog's open state.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // Map the native cancel (Escape) event to onClose.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener("cancel", handleCancel);
    return () => el.removeEventListener("cancel", handleCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-label={ariaLabel}
      onClick={(e) => {
        // Clicking the backdrop (the dialog itself, not its children) closes.
        if (e.target === ref.current) onClose();
      }}
      className={[
        // `m-auto` restores the dialog's user-agent auto-centering, which
        // Tailwind v4's preflight resets to 0. `max-h` + `overflow-y-auto`
        // keep tall modals scrollable instead of bleeding off-screen.
        "border-border bg-surface shadow-popup fixed inset-0 m-auto h-fit max-h-[calc(100vh-32px)] w-[min(560px,calc(100vw-32px))] overflow-y-auto rounded-3xl border p-0 backdrop:bg-black/40",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </dialog>
  );
}

export function ModalHeader({
  title,
  description,
  onClose,
}: {
  title: string;
  description?: string;
  onClose?: () => void;
}) {
  return (
    <div className="border-border flex items-start justify-between gap-4 border-b px-6 pt-5 pb-4">
      <div className="min-w-0">
        <h2 className="font-display text-ink text-[17px] font-semibold">{title}</h2>
        {description && <p className="text-muted mt-1 text-[13px]">{description}</p>}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-muted-2 hover:bg-canvas hover:text-ink flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md transition-colors"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function ModalBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={["px-6 py-5", className ?? ""].filter(Boolean).join(" ")}>{children}</div>;
}

export function ModalFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={[
        "border-border flex items-center justify-end gap-2 border-t px-6 py-4",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
