"use client";

import { useState, useTransition } from "react";
import { PORTAL_FEEDBACK_BODY_MAX } from "@/lib/portal-limits";
import { submitPortalFeedbackAction } from "@/app/portal/[token]/actions";

/**
 * Portal-side output card (Phase 3.8 redesign).
 *
 * The parent `/portal/[token]/page.tsx` is a server component that renders
 * one of these per approved / scheduled / published deliverable. Everything
 * interactive lives here: copy-to-clipboard, feedback affordance, and the
 * status chip that reads the current lifecycle state.
 *
 * Design language:
 *   - Status is the top-line info. The chip carries color + label + date.
 *   - Content sits in an unbounded scrollable box so shorter posts don't
 *     feel padded and longer ones don't force a full-page scroll.
 *   - Copy + feedback are quiet secondary affordances at the footer.
 *   - Feedback form is a collapsible textarea — inline so a client with
 *     one small note doesn't have to navigate away, hidden by default so
 *     the primary card layout stays uncluttered.
 */

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const APPROVED_COLOR = "#5A6473";
const APPROVED_BG = "rgba(90,100,115,0.10)";
const SCHEDULED_COLOR_FALLBACK = "#3A5BA0";
const PUBLISHED_COLOR = "#1E7A47";
const PUBLISHED_BG = "rgba(30,122,71,0.10)";

type LifecycleStatus = "APPROVED" | "SCHEDULED" | "PUBLISHED";

export function PortalOutputCard({
  outputId,
  token,
  platformName,
  platformBadge,
  platformBadgeBg,
  platformBadgeColor,
  platformBadgeBorder,
  status,
  approvedAtIso,
  scheduledForIso,
  publishedAtIso,
  externalPostUrl,
  content,
  accentColor,
}: {
  outputId: string;
  token: string;
  platformName: string;
  platformBadge: string;
  platformBadgeBg: string;
  platformBadgeColor: string;
  platformBadgeBorder: string;
  status: LifecycleStatus;
  approvedAtIso: string | null;
  scheduledForIso: string | null;
  publishedAtIso: string | null;
  externalPostUrl: string | null;
  content: string;
  accentColor: string;
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackBody, setFeedbackBody] = useState("");
  const [feedbackEmail, setFeedbackEmail] = useState("");
  const [feedbackState, setFeedbackState] = useState<
    { kind: "idle" } | { kind: "sent" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const [justCopied, setJustCopied] = useState(false);
  const copy = () => {
    if (!navigator.clipboard) return;
    navigator.clipboard
      .writeText(content)
      .then(() => {
        setJustCopied(true);
        setTimeout(() => setJustCopied(false), 1600);
      })
      .catch(() => undefined);
  };

  const submitFeedback = () => {
    const body = feedbackBody.trim();
    if (body.length === 0) return;
    startTransition(async () => {
      const result = await submitPortalFeedbackAction({
        token,
        outputId,
        body,
        fromEmail: feedbackEmail.trim() || undefined,
      });
      if (result.ok) {
        setFeedbackState({ kind: "sent" });
        setFeedbackBody("");
        setFeedbackEmail("");
        setTimeout(() => {
          setFeedbackOpen(false);
          setFeedbackState({ kind: "idle" });
        }, 2200);
        return;
      }
      if (result.reason === "throttled") {
        setFeedbackState({
          kind: "error",
          message: "You've sent a lot of feedback already — take a breath and try again in a bit.",
        });
        return;
      }
      setFeedbackState({
        kind: "error",
        message: "This portal link is no longer valid. Ask your agency for a fresh one.",
      });
    });
  };

  const chip = statusChip({
    status,
    approvedAtIso,
    scheduledForIso,
    publishedAtIso,
    accentColor,
  });

  return (
    <div className="border-t border-[#F0F3F8] px-5 py-4 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-[10px]">
          <span
            className="font-display flex h-[26px] w-[26px] items-center justify-center rounded-md text-[11px] font-bold"
            style={{
              background: platformBadgeBg,
              color: platformBadgeColor,
              border: `1px solid ${platformBadgeBorder}`,
            }}
          >
            {platformBadge}
          </span>
          <div className="text-ink font-sans text-[13px] font-semibold">{platformName}</div>
        </div>
        <div className="flex items-center gap-[6px]">
          <span
            className="rounded-pill px-[9px] py-[3px] font-sans text-[11px] font-semibold tabular-nums"
            style={{ background: chip.bg, color: chip.color }}
          >
            {chip.label}
          </span>
          {externalPostUrl && status === "PUBLISHED" && (
            <a
              href={externalPostUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-2 hover:text-ink inline-flex items-center gap-[3px] rounded-md px-[8px] py-[3px] font-sans text-[11px] font-medium transition-colors"
              style={{ border: "1px solid #E4E8F0" }}
            >
              View
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden
              >
                <path d="M3 3h4v4M7 3L3 7" strokeLinecap="round" />
              </svg>
            </a>
          )}
        </div>
      </div>

      <div className="bg-canvas mt-[10px] max-h-[260px] overflow-y-auto rounded-[10px] p-3 font-sans text-[13px] leading-[1.6] whitespace-pre-wrap text-[#39435A]">
        {content}
      </div>

      <div className="mt-[10px] flex flex-wrap items-center justify-between gap-2">
        <div className="text-muted-2 flex flex-wrap items-center gap-[10px] font-mono text-[10.5px] tracking-[0.02em] tabular-nums">
          {approvedAtIso && (
            <span>
              <span className="uppercase opacity-70">Approved</span>{" "}
              {DATE_FMT.format(new Date(approvedAtIso))}
            </span>
          )}
          {scheduledForIso && (
            <span>
              <span className="uppercase opacity-70">Scheduled</span>{" "}
              {DATE_FMT.format(new Date(scheduledForIso))}
            </span>
          )}
          {publishedAtIso && (
            <span>
              <span className="uppercase opacity-70">Published</span>{" "}
              {DATE_FMT.format(new Date(publishedAtIso))}
            </span>
          )}
        </div>
        <div className="flex items-center gap-[6px]">
          <button
            type="button"
            onClick={copy}
            className="text-muted hover:text-ink inline-flex items-center gap-[4px] rounded-md px-[8px] py-[4px] font-sans text-[11.5px] font-medium transition-colors"
            style={{ border: "1px solid #E4E8F0" }}
          >
            {justCopied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={() => setFeedbackOpen((v) => !v)}
            className="text-muted hover:text-ink inline-flex items-center gap-[4px] rounded-md px-[8px] py-[4px] font-sans text-[11.5px] font-medium transition-colors"
            style={{ border: "1px solid #E4E8F0" }}
            aria-expanded={feedbackOpen}
          >
            {feedbackOpen ? "Cancel" : "Send feedback"}
          </button>
        </div>
      </div>

      {feedbackOpen && (
        <div className="mt-[10px] rounded-[10px] border border-[#E4E8F0] bg-[#FBFCFE] p-3">
          {feedbackState.kind === "sent" ? (
            <div className="text-[12.5px] leading-[1.5] text-[#1E7A47]">
              Thanks — your feedback has been sent to the team.
            </div>
          ) : (
            <>
              <label className="text-muted-2 mb-1 block font-mono text-[10.5px] tracking-[0.06em] uppercase">
                Notes for the agency
              </label>
              <textarea
                value={feedbackBody}
                onChange={(e) => setFeedbackBody(e.target.value.slice(0, PORTAL_FEEDBACK_BODY_MAX))}
                rows={3}
                placeholder="Something you'd tweak? A callout you loved? Let them know."
                className="w-full resize-y rounded-md border border-[#E4E8F0] bg-white px-3 py-2 font-sans text-[13px] leading-[1.5] text-[#1A2A4A] outline-none focus:border-[#3A5BA0]"
              />
              <div className="mt-[6px] flex flex-wrap items-center justify-between gap-2">
                <input
                  type="email"
                  value={feedbackEmail}
                  onChange={(e) => setFeedbackEmail(e.target.value)}
                  placeholder="Your email (optional)"
                  className="max-w-[220px] flex-1 rounded-md border border-[#E4E8F0] bg-white px-2 py-[6px] font-sans text-[12px] text-[#1A2A4A] outline-none focus:border-[#3A5BA0]"
                />
                <div className="flex items-center gap-2">
                  <span className="text-muted-2 font-mono text-[10.5px] tabular-nums">
                    {feedbackBody.length}/{PORTAL_FEEDBACK_BODY_MAX}
                  </span>
                  <button
                    type="button"
                    onClick={submitFeedback}
                    disabled={pending || feedbackBody.trim().length === 0}
                    className="rounded-md px-[10px] py-[5px] font-sans text-[12px] font-semibold text-white transition-[filter] disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ background: accentColor }}
                  >
                    {pending ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
              {feedbackState.kind === "error" && (
                <div className="mt-2 text-[12px] text-[#A03030]">{feedbackState.message}</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function statusChip({
  status,
  approvedAtIso,
  scheduledForIso,
  publishedAtIso,
  accentColor,
}: {
  status: LifecycleStatus;
  approvedAtIso: string | null;
  scheduledForIso: string | null;
  publishedAtIso: string | null;
  accentColor: string;
}): { label: string; bg: string; color: string } {
  if (status === "PUBLISHED") {
    const when = publishedAtIso ? ` · ${DATE_FMT.format(new Date(publishedAtIso))}` : "";
    return { label: `Published${when}`, bg: PUBLISHED_BG, color: PUBLISHED_COLOR };
  }
  if (status === "SCHEDULED") {
    const when = scheduledForIso ? ` · ${DATE_FMT.format(new Date(scheduledForIso))}` : "";
    // Scheduled uses the agency's accent color so the "coming up" state
    // reads as branded. Fallback for accent-less setups is our own navy.
    const color = accentColor || SCHEDULED_COLOR_FALLBACK;
    return { label: `Scheduled${when}`, bg: `${color}1A`, color };
  }
  const when = approvedAtIso ? ` · ${DATE_FMT.format(new Date(approvedAtIso))}` : "";
  return { label: `Approved${when}`, bg: APPROVED_BG, color: APPROVED_COLOR };
}
