"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import type { SuggestionType } from "@prisma/client";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { submitSuggestionAction } from "./feedback-actions";

const ACCENT = "#3A5BA0";
const INK = "#0a1e3c";
const MUTED = "#41506b";
const OUTLINE = "#d4dbe7";

const TYPE_OPTIONS: readonly { value: SuggestionType; label: string; hint: string }[] = [
  { value: "BUG", label: "Bug", hint: "Something is broken or behaving unexpectedly" },
  { value: "FEATURE_REQUEST", label: "Feature request", hint: "Something new you'd like to see" },
  { value: "IMPROVEMENT", label: "Improvement", hint: "A tweak to an existing feature" },
  { value: "QUESTION", label: "Question", hint: "You want to understand something" },
  { value: "OTHER", label: "Other", hint: "Anything that doesn't fit above" },
];

/**
 * Floating "Send feedback" affordance on every dashboard page. Opens a
 * modal with a type picker + title + body, submits via a server action
 * that creates the `Suggestion` row and mirrors to the feedback inbox.
 *
 * Placement — bottom-right, above the fold on scrollable pages. Sits
 * inside the dashboard main scroller so it doesn't fight the sidebar or
 * the impersonation / trial banners at the top of the layout.
 */
export function FeedbackButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<SuggestionType>("BUG");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  // Reset the form each time the modal closes so a follow-up open starts
  // fresh rather than showing the previous submission.
  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setType("BUG");
      setTitle("");
      setBody("");
      setError(null);
      setSent(false);
    }, 200);
    return () => clearTimeout(t);
  }, [open]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (trimmedTitle.length < 3) {
      setError("Add a short title (at least 3 characters).");
      return;
    }
    if (trimmedBody.length < 10) {
      setError("Give us a bit more detail (at least 10 characters).");
      return;
    }
    startTransition(async () => {
      const result = await submitSuggestionAction({
        type,
        title: trimmedTitle,
        body: trimmedBody,
        contextUrl: pathname || undefined,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSent(true);
    });
  };

  return (
    <>
      <button
        type="button"
        aria-label="Send feedback"
        onClick={() => setOpen(true)}
        className="fixed right-5 bottom-5 z-40 flex items-center gap-2 rounded-full shadow-lg transition-[filter] hover:brightness-95"
        style={{
          background: ACCENT,
          color: "#fff",
          padding: "10px 16px",
          fontSize: 13.5,
          fontWeight: 600,
          border: "none",
          fontFamily: "inherit",
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M2 3.5h10v6H5.5L3 12V9.5H2z" />
        </svg>
        Feedback
      </button>

      <Modal open={open} onClose={() => setOpen(false)} ariaLabel="Send feedback">
        {sent ? (
          <>
            <ModalHeader
              title="Thanks — we got it"
              description="Your feedback landed in our triage queue. We read every one."
              onClose={() => setOpen(false)}
            />
            <ModalFooter>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={buttonStyle({ variant: "primary" })}
              >
                Close
              </button>
            </ModalFooter>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <ModalHeader
              title="Send feedback"
              description="Report a bug, request a feature, or share an idea."
              onClose={() => setOpen(false)}
            />
            <ModalBody className="flex flex-col gap-4">
              <fieldset className="flex flex-col gap-2" disabled={pending}>
                <legend className="text-[12px] font-semibold" style={{ color: INK }}>
                  Type
                </legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {TYPE_OPTIONS.map((opt) => {
                    const active = type === opt.value;
                    return (
                      <label
                        key={opt.value}
                        className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors"
                        style={{
                          borderColor: active ? ACCENT : OUTLINE,
                          background: active ? "rgba(58,91,160,0.06)" : "#fff",
                        }}
                      >
                        <input
                          type="radio"
                          name="type"
                          value={opt.value}
                          checked={active}
                          onChange={() => setType(opt.value)}
                          className="mt-[3px]"
                        />
                        <div className="min-w-0">
                          <div
                            className="text-[13px] font-semibold"
                            style={{ color: active ? ACCENT : INK }}
                          >
                            {opt.label}
                          </div>
                          <div className="text-[11.5px]" style={{ color: MUTED }}>
                            {opt.hint}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div className="flex flex-col gap-1">
                <label
                  htmlFor="feedback-title"
                  className="text-[12px] font-semibold"
                  style={{ color: INK }}
                >
                  Title
                </label>
                <input
                  id="feedback-title"
                  type="text"
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={pending}
                  placeholder="One-line summary"
                  style={{
                    border: `1px solid ${OUTLINE}`,
                    borderRadius: 8,
                    padding: "10px 14px",
                    fontSize: 14,
                    color: INK,
                    fontFamily: "inherit",
                    outline: "none",
                  }}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label
                  htmlFor="feedback-body"
                  className="text-[12px] font-semibold"
                  style={{ color: INK }}
                >
                  Details
                </label>
                <textarea
                  id="feedback-body"
                  rows={6}
                  maxLength={10_000}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={pending}
                  placeholder="Steps to reproduce, what you expected, or the outcome you'd like."
                  style={{
                    border: `1px solid ${OUTLINE}`,
                    borderRadius: 8,
                    padding: "10px 14px",
                    fontSize: 14,
                    color: INK,
                    fontFamily: "inherit",
                    outline: "none",
                    resize: "vertical",
                  }}
                />
              </div>

              {error ? (
                <div
                  role="alert"
                  className="rounded-md px-3 py-2 text-[12.5px]"
                  style={{ background: "#FBEAEA", color: "#8B2E2E" }}
                >
                  {error}
                </div>
              ) : null}
            </ModalBody>
            <ModalFooter>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                style={buttonStyle({ variant: "secondary" })}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                style={buttonStyle({ variant: "primary", pending })}
              >
                {pending ? "Sending…" : "Send feedback"}
              </button>
            </ModalFooter>
          </form>
        )}
      </Modal>
    </>
  );
}

function buttonStyle({
  variant,
  pending,
}: {
  variant: "primary" | "secondary";
  pending?: boolean;
}): React.CSSProperties {
  if (variant === "primary") {
    return {
      background: ACCENT,
      color: "#fff",
      border: "none",
      borderRadius: 8,
      padding: "9px 16px",
      fontSize: 13.5,
      fontWeight: 600,
      cursor: pending ? "wait" : "pointer",
      fontFamily: "inherit",
    };
  }
  return {
    background: "#fff",
    color: MUTED,
    border: `1px solid ${OUTLINE}`,
    borderRadius: 8,
    padding: "9px 16px",
    fontSize: 13.5,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
