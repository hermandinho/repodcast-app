"use client";

import { useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import type { SupportTicketCategory } from "@prisma/client";
import { TurnstileWidget } from "@/components/security/turnstile-widget";
import { submitSupportTicketAction } from "./actions";

const ACCENT = "#3A5BA0";
const INK = "#1A2A4A";
const MUTED = "#5A6473";
const OUTLINE = "#d4dbe7";

type CategoryOption = { value: SupportTicketCategory; label: string; hint: string };

const CATEGORY_OPTIONS: readonly CategoryOption[] = [
  { value: "BUG", label: "Something is broken", hint: "A page, feature, or export isn't working." },
  {
    value: "QUESTION",
    label: "How-to question",
    hint: "You want to understand how something works.",
  },
  { value: "BILLING", label: "Billing", hint: "Invoices, plan changes, refunds, tax." },
  { value: "ACCOUNT", label: "Account access", hint: "Login, workspace, member permissions." },
  {
    value: "FEATURE_REQUEST",
    label: "Feature request",
    hint: "Something you'd like Repodcast to do.",
  },
  { value: "OTHER", label: "Something else", hint: "Anything that doesn't fit above." },
];

/**
 * Public `/contact` support form. Server-first: on submit we call
 * `submitSupportTicketAction` which handles Turnstile verify + DB write
 * + two fire-and-forget emails. Signed-in visitors get `initialName` /
 * `initialEmail` prefilled from the auth context (they can still edit
 * before sending — e.g. writing from a workspace they're helping run).
 */
export function SupportForm({
  initialName,
  initialEmail,
  isSignedIn,
}: {
  initialName: string;
  initialEmail: string;
  isSignedIn: boolean;
}) {
  const pathname = usePathname();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [category, setCategory] = useState<SupportTicketCategory>("QUESTION");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ refCode: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();

    if (trimmedName.length < 2) {
      setError("Add your name.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    if (trimmedSubject.length < 3) {
      setError("Add a short subject.");
      return;
    }
    if (trimmedBody.length < 10) {
      setError("Give us a bit more detail (at least 10 characters).");
      return;
    }
    // `turnstileToken` is `null` while the widget is still loading and
    // `""` when Turnstile isn't configured (dev). Either is fine — the
    // server treats both as "no challenge attached" and the verify util
    // decides whether that's fatal for this env.
    if (turnstileToken === null && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
      setError("Please wait for the anti-spam check to finish.");
      return;
    }

    startTransition(async () => {
      const result = await submitSupportTicketAction({
        name: trimmedName,
        email: trimmedEmail,
        category,
        subject: trimmedSubject,
        body: trimmedBody,
        contextUrl: pathname || undefined,
        turnstileToken: turnstileToken ?? "",
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess({ refCode: result.refCode });
    });
  };

  if (success) {
    return (
      <div
        className="rounded-2xl p-6 sm:p-8"
        style={{
          background: "#FFFFFF",
          border: "1px solid #ECEEF3",
          boxShadow: "0 1px 2px rgba(26,42,74,0.03)",
        }}
      >
        <p
          className="m-0 text-[11px] font-medium uppercase"
          style={{
            fontFamily: "var(--font-mono)",
            color: ACCENT,
            letterSpacing: "0.14em",
          }}
        >
          Message received
        </p>
        <h2
          className="mt-3 mb-3 text-[22px] font-semibold sm:text-[26px]"
          style={{
            fontFamily: "var(--font-display)",
            color: INK,
            letterSpacing: "-0.01em",
          }}
        >
          Thanks — we got it.
        </h2>
        <p className="m-0 text-[14.5px]" style={{ color: MUTED, lineHeight: 1.65 }}>
          A human will read your message and reply within one business day. We&rsquo;ve sent a copy
          of the confirmation to <strong style={{ color: INK }}>{email}</strong>.
        </p>
        <div
          className="mt-5 rounded-xl px-4 py-3"
          style={{ background: "#F4F6FA", border: "1px solid #E6EBF3" }}
        >
          <p
            className="m-0 text-[11px] font-medium uppercase"
            style={{ fontFamily: "var(--font-mono)", color: MUTED, letterSpacing: "0.14em" }}
          >
            Your reference
          </p>
          <p
            className="m-0 mt-1 text-[16px] font-semibold"
            style={{ fontFamily: "var(--font-mono)", color: INK }}
          >
            {success.refCode}
          </p>
          <p className="m-0 mt-2 text-[12.5px]" style={{ color: MUTED, lineHeight: 1.55 }}>
            Quote this reference if you write to us again — it threads everything into the same
            ticket.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setSuccess(null);
            setSubject("");
            setBody("");
            setTurnstileToken(null);
          }}
          className="mt-6 text-[13.5px] font-medium"
          style={{
            background: "transparent",
            color: ACCENT,
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl p-6 sm:p-8"
      style={{
        background: "#FFFFFF",
        border: "1px solid #ECEEF3",
        boxShadow: "0 1px 2px rgba(26,42,74,0.03)",
      }}
    >
      <p
        className="m-0 text-[11px] font-medium uppercase"
        style={{
          fontFamily: "var(--font-mono)",
          color: ACCENT,
          letterSpacing: "0.14em",
        }}
      >
        Contact support
      </p>
      <h2
        className="mt-3 mb-2 text-[22px] font-semibold sm:text-[26px]"
        style={{
          fontFamily: "var(--font-display)",
          color: INK,
          letterSpacing: "-0.01em",
        }}
      >
        Send us a message.
      </h2>
      <p className="m-0 mb-6 text-[14.5px]" style={{ color: MUTED, lineHeight: 1.65 }}>
        {isSignedIn
          ? "Your workspace and email are attached to the ticket automatically."
          : "Please include enough detail for us to help without a follow-up round."}{" "}
        First response within one business day.
      </p>

      <fieldset className="m-0 flex flex-col gap-5 border-0 p-0" disabled={pending}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FieldLabel label="Your name" htmlFor="support-name">
            <input
              id="support-name"
              type="text"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Jane Anders"
              style={inputStyle}
            />
          </FieldLabel>
          <FieldLabel label="Email" htmlFor="support-email">
            <input
              id="support-email"
              type="email"
              maxLength={320}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              style={inputStyle}
            />
          </FieldLabel>
        </div>

        <FieldLabel label="Category" htmlFor="support-category">
          <select
            id="support-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as SupportTicketCategory)}
            style={{ ...inputStyle, appearance: "none", background: "#fff" }}
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="m-0 mt-1 text-[12px]" style={{ color: MUTED }}>
            {CATEGORY_OPTIONS.find((o) => o.value === category)?.hint}
          </p>
        </FieldLabel>

        <FieldLabel label="Subject" htmlFor="support-subject">
          <input
            id="support-subject"
            type="text"
            maxLength={200}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="One-line summary"
            style={inputStyle}
          />
        </FieldLabel>

        <FieldLabel label="How can we help?" htmlFor="support-body">
          <textarea
            id="support-body"
            rows={7}
            maxLength={10_000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Steps to reproduce, what you expected, or the outcome you're after. If it helps, paste a URL or screenshot link."
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </FieldLabel>

        <TurnstileWidget
          onToken={(t) => setTurnstileToken(t)}
          onError={() => setTurnstileToken(null)}
          onExpire={() => setTurnstileToken(null)}
        />

        {error ? (
          <div
            role="alert"
            className="rounded-md px-3 py-2 text-[13px]"
            style={{ background: "#FBEAEA", color: "#8B2E2E" }}
          >
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            style={{
              background: ACCENT,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 600,
              cursor: pending ? "wait" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {pending ? "Sending…" : "Send message"}
          </button>
          <p className="m-0 text-[12.5px]" style={{ color: MUTED }}>
            We respond within one business day.
          </p>
        </div>
      </fieldset>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  border: `1px solid ${OUTLINE}`,
  borderRadius: 8,
  padding: "10px 14px",
  fontSize: 14,
  color: INK,
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
  background: "#fff",
};

function FieldLabel({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-[12px] font-semibold"
        style={{ color: INK, letterSpacing: "0.01em" }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
