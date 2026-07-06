"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateClientWorkflowAction } from "@/app/(dashboard)/clients/actions";

/**
 * Per-client workflow configuration form. Two settings:
 *
 * 1. **Validation mode** — INTERNAL (agency team approves) or CLIENT
 *    (approved outputs go to the client portal for final sign-off before
 *    scheduling). Radio; mirrored on the server via `Client.validationMode`.
 * 2. **Notification emails** — the extra recipients (on top of every
 *    agency OWNER/ADMIN) who receive workflow event emails: review
 *    requested, client approved, client requested revision. Comma / newline
 *    separated on entry, chip-rendered underneath. Owner email is always
 *    included implicitly — this list is a supplement.
 *
 * The form is optimistic: submit disables the primary CTA + calls
 * `router.refresh()` on success so the persisted values re-hydrate. Errors
 * bubble via a small inline banner.
 */

type ValidationMode = "INTERNAL" | "CLIENT";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function WorkflowForm({
  clientId,
  initialValidationMode,
  initialNotificationEmails,
  ownerEmail,
}: {
  clientId: string;
  initialValidationMode: ValidationMode;
  initialNotificationEmails: string[];
  /** Owner email is auto-included in fan-out — surfaced here so the user
   *  understands the list is additive, not exclusive. */
  ownerEmail: string | null;
}) {
  const router = useRouter();
  const [validationMode, setValidationMode] = useState<ValidationMode>(initialValidationMode);
  const [emails, setEmails] = useState<string[]>(initialNotificationEmails);
  const [emailInput, setEmailInput] = useState("");
  const [state, setState] = useState<
    { kind: "idle" } | { kind: "saved" } | { kind: "error"; message: string }
  >({
    kind: "idle",
  });
  const [pending, startTransition] = useTransition();

  const addEmails = (raw: string) => {
    const parts = raw
      .split(/[\s,;]+/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) return;
    const invalid: string[] = [];
    const next = [...emails];
    for (const p of parts) {
      if (!EMAIL_RE.test(p)) {
        invalid.push(p);
        continue;
      }
      if (!next.includes(p)) next.push(p);
    }
    if (invalid.length > 0) {
      setState({
        kind: "error",
        message: `Not a valid email: ${invalid.join(", ")}`,
      });
      return;
    }
    if (next.length > 10) {
      setState({
        kind: "error",
        message: "Cap is 10 notification emails per client.",
      });
      return;
    }
    setEmails(next);
    setEmailInput("");
    setState({ kind: "idle" });
  };

  const removeEmail = (email: string) => {
    setEmails((prev) => prev.filter((e) => e !== email));
    setState({ kind: "idle" });
  };

  const submit = () => {
    // Flush any pending input into the chip list before saving so the user
    // doesn't lose a half-typed email on submit.
    const pendingEmail = emailInput.trim().toLowerCase();
    if (pendingEmail && !emails.includes(pendingEmail)) {
      if (!EMAIL_RE.test(pendingEmail)) {
        setState({ kind: "error", message: `Not a valid email: ${pendingEmail}` });
        return;
      }
      setEmails((prev) => [...prev, pendingEmail]);
    }
    startTransition(async () => {
      const finalEmails =
        pendingEmail && !emails.includes(pendingEmail) && EMAIL_RE.test(pendingEmail)
          ? [...emails, pendingEmail]
          : emails;
      try {
        const result = await updateClientWorkflowAction({
          clientId,
          validationMode,
          notificationEmails: finalEmails,
        });
        if (result.ok) {
          setState({ kind: "saved" });
          setEmailInput("");
          router.refresh();
          setTimeout(() => setState({ kind: "idle" }), 2200);
        } else {
          setState({ kind: "error", message: result.error });
        }
      } catch (err) {
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Something went wrong",
        });
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="border-border bg-surface rounded-2xl border p-5">
        <h2 className="font-display text-ink text-[15px] font-semibold">Who approves outputs?</h2>
        <p className="text-muted mt-1 max-w-[560px] text-[12.5px] leading-[1.55]">
          Pick who signs off on generated posts before they can be scheduled. This is per client —
          switch modes anytime.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <ModeOption
            checked={validationMode === "INTERNAL"}
            onChange={() => setValidationMode("INTERNAL")}
            title="Our team validates"
            description="Your OWNER, ADMIN, and REVIEWER teammates approve outputs from the dashboard. After approval, only the OWNER can edit; editors cannot."
          />
          <ModeOption
            checked={validationMode === "CLIENT"}
            onChange={() => setValidationMode("CLIENT")}
            title="The client validates"
            description="After your team reviews, outputs go to the client's portal for final approval before they can be scheduled. Once the client approves, the output is locked — no one can edit or regenerate."
          />
        </div>
      </section>

      <section className="border-border bg-surface rounded-2xl border p-5">
        <h2 className="font-display text-ink text-[15px] font-semibold">Notification emails</h2>
        <p className="text-muted mt-1 max-w-[560px] text-[12.5px] leading-[1.55]">
          People who receive workflow emails: review requested, client approved, revision requested.
          {ownerEmail && (
            <>
              {" "}
              The workspace owner (<span className="text-ink font-medium">{ownerEmail}</span>) is
              always included.
            </>
          )}{" "}
          Add up to 10 additional recipients.
        </p>

        {emails.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-[6px]">
            {emails.map((email) => (
              <span
                key={email}
                className="border-border inline-flex items-center gap-2 rounded-md border bg-white px-[10px] py-[5px] font-sans text-[12px]"
              >
                {email}
                <button
                  type="button"
                  onClick={() => removeEmail(email)}
                  className="text-muted-2 hover:text-ink text-[13px] leading-none"
                  aria-label={`Remove ${email}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addEmails(emailInput);
              }
            }}
            onBlur={() => {
              if (emailInput.trim()) addEmails(emailInput);
            }}
            placeholder="hello@example.com"
            className="min-w-[220px] flex-1 rounded-md border border-[#E4E8F0] bg-white px-3 py-[8px] font-sans text-[13px] text-[#1A2A4A] outline-none focus:border-[#3A5BA0]"
          />
          <button
            type="button"
            onClick={() => addEmails(emailInput)}
            disabled={!emailInput.trim()}
            className="text-muted hover:text-ink rounded-md border border-[#E4E8F0] bg-white px-3 py-[8px] font-sans text-[12.5px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </section>

      <div className="flex items-center justify-between gap-3">
        <div className="text-[12.5px]">
          {state.kind === "saved" && <span className="text-[#1E7A47]">Saved.</span>}
          {state.kind === "error" && <span className="text-[#A03030]">{state.message}</span>}
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-md px-4 py-[9px] font-sans text-[13px] font-semibold text-white transition-[filter] disabled:cursor-not-allowed disabled:opacity-50"
          style={{ background: "var(--color-accent, #1A2A4A)" }}
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function ModeOption({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  description: string;
}) {
  return (
    <label
      className="border-border flex cursor-pointer items-start gap-3 rounded-lg border bg-white p-4 transition-colors"
      style={{
        borderColor: checked ? "var(--color-accent, #1A2A4A)" : "#E4E8F0",
        background: checked ? "#F7F8FE" : "white",
      }}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="mt-[3px] h-4 w-4 flex-shrink-0"
      />
      <div>
        <div className="text-ink font-sans text-[13.5px] font-semibold">{title}</div>
        <div className="text-muted mt-1 text-[12.5px] leading-[1.5]">{description}</div>
      </div>
    </label>
  );
}
