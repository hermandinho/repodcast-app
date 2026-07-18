"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
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
 * Floating "?" help affordance on every dashboard page. Opens a small
 * popover with two entries:
 *
 *   - Send feedback — the existing Suggestion form, delivered inline
 *     via a modal that submits to `submitSuggestionAction`.
 *   - Contact support — links to `/contact?ref=dashboard` where the
 *     public support form lives; signed-in visitors get name/email
 *     prefilled by the page.
 *
 * The two routes go to different inboxes (feedback → product triage,
 * support → ops), so they're kept as sibling entries rather than
 * collapsed into one form.
 *
 * Placement — bottom-right, above the fold on scrollable pages. Sits
 * inside the dashboard main scroller so it doesn't fight the sidebar or
 * the impersonation / trial banners at the top of the layout.
 */
export function HelpMenu() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<SuggestionType>("BUG");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  // Close the popover on outside-click or Escape. Standard popover UX;
  // the modal itself owns its own focus trap once opened.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

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
        ref={triggerRef}
        aria-label="Help"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
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
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M5 5a2 2 0 1 1 3 1.7c-.7.4-1 .8-1 1.6" />
          <circle cx="7" cy="10.5" r="0.4" fill="currentColor" stroke="none" />
        </svg>
        Help
      </button>

      {menuOpen ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Help"
          className="fixed right-5 bottom-[62px] z-40 flex flex-col overflow-hidden rounded-xl"
          style={{
            background: "#fff",
            border: `1px solid ${OUTLINE}`,
            boxShadow: "0 12px 32px rgba(10,30,60,0.14)",
            minWidth: 220,
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              setOpen(true);
            }}
            style={menuItemStyle}
          >
            <span style={{ color: INK, fontWeight: 600 }}>Send feedback</span>
            <span className="text-[11.5px]" style={{ color: MUTED }}>
              Bugs, ideas, small tweaks.
            </span>
          </button>
          <div style={{ height: 1, background: "#F0F3F8" }} />
          <Link
            href="/contact?ref=dashboard"
            role="menuitem"
            onClick={() => setMenuOpen(false)}
            style={{ ...menuItemStyle, textDecoration: "none" }}
          >
            <span style={{ color: INK, fontWeight: 600 }}>Contact support</span>
            <span className="text-[11.5px]" style={{ color: MUTED }}>
              Help from a human within one business day.
            </span>
          </Link>
        </div>
      ) : null}

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

const menuItemStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 2,
  padding: "12px 14px",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "inherit",
  fontSize: 13.5,
};

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
