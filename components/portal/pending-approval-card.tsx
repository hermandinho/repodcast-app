"use client";

import { useState, useTransition } from "react";
import { PORTAL_FEEDBACK_BODY_MAX } from "@/lib/portal-limits";
import {
  submitPortalApprovalAction,
  submitPortalRevisionRequestAction,
} from "@/app/portal/[token]/actions";

/**
 * Portal-side card for outputs in AWAITING_CLIENT_APPROVAL. Rendered above
 * the delivered content list on `/portal/[token]/page.tsx` when the parent
 * client is running the CLIENT validation flow.
 *
 * Two actions:
 *   - Approve — hits `submitPortalApprovalAction`; the output moves out of
 *     the pending section on the next render.
 *   - Request revision — opens an inline note textarea, hits
 *     `submitPortalRevisionRequestAction`. The optional note is also
 *     recorded as portal feedback so the agency inbox has a single place
 *     to triage.
 *
 * Once an output is approved via this card, it becomes frozen — no one on
 * the agency side can edit or regenerate it. The submit button is disabled
 * during the transition to avoid double-fires.
 */

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

type ActionState =
  | { kind: "idle" }
  | { kind: "approved" }
  | { kind: "revision_sent" }
  | { kind: "error"; message: string };

export function PortalPendingApprovalCard({
  outputId,
  token,
  platformName,
  platformBadge,
  platformBadgeBg,
  platformBadgeColor,
  platformBadgeBorder,
  sentToClientAtIso,
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
  sentToClientAtIso: string | null;
  content: string;
  accentColor: string;
}) {
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<ActionState>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const approve = () => {
    startTransition(async () => {
      const result = await submitPortalApprovalAction({
        token,
        outputId,
        fromEmail: email.trim() || undefined,
      });
      if (result.ok) {
        setState({ kind: "approved" });
        return;
      }
      setState({ kind: "error", message: reasonToMessage(result.reason) });
    });
  };

  const requestRevision = () => {
    const note = revisionNote.trim();
    startTransition(async () => {
      const result = await submitPortalRevisionRequestAction({
        token,
        outputId,
        fromEmail: email.trim() || undefined,
        note: note || undefined,
      });
      if (result.ok) {
        setState({ kind: "revision_sent" });
        setRevisionNote("");
        return;
      }
      setState({ kind: "error", message: reasonToMessage(result.reason) });
    });
  };

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
        <span
          className="rounded-pill px-[9px] py-[3px] font-sans text-[11px] font-semibold tabular-nums"
          style={{ background: `${accentColor}1A`, color: accentColor }}
        >
          {sentToClientAtIso
            ? `Sent ${DATE_FMT.format(new Date(sentToClientAtIso))}`
            : "Awaiting your approval"}
        </span>
      </div>

      <div className="bg-canvas mt-[10px] max-h-[260px] overflow-y-auto rounded-[10px] p-3 font-sans text-[13px] leading-[1.6] whitespace-pre-wrap text-[#39435A]">
        {content}
      </div>

      {state.kind === "approved" ? (
        <div className="mt-[12px] rounded-[10px] border border-[#CEE5D8] bg-[#EEF7F1] px-3 py-[10px] text-[12.5px] leading-[1.5] text-[#1E7A47]">
          Approved. Your agency can now schedule this post.
        </div>
      ) : state.kind === "revision_sent" ? (
        <div className="mt-[12px] rounded-[10px] border border-[#E4E8F0] bg-[#F4F6FA] px-3 py-[10px] text-[12.5px] leading-[1.5] text-[#3A4152]">
          Sent — your agency has been notified.
        </div>
      ) : (
        <>
          <div className="mt-[12px] flex flex-wrap items-center gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Your email (optional)"
              className="max-w-[240px] flex-1 rounded-md border border-[#E4E8F0] bg-white px-2 py-[7px] font-sans text-[12px] text-[#1A2A4A] outline-none focus:border-[#3A5BA0]"
            />
            <button
              type="button"
              onClick={() => setRevisionOpen((v) => !v)}
              disabled={pending}
              className="text-muted hover:text-ink rounded-md px-[10px] py-[6px] font-sans text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              style={{ border: "1px solid #E4E8F0" }}
            >
              {revisionOpen ? "Cancel revision" : "Request revision"}
            </button>
            <button
              type="button"
              onClick={approve}
              disabled={pending}
              className="rounded-md px-[12px] py-[6px] font-sans text-[12px] font-semibold text-white transition-[filter] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: accentColor }}
            >
              {pending ? "Approving…" : "Approve"}
            </button>
          </div>

          {revisionOpen && (
            <div className="mt-[10px] rounded-[10px] border border-[#E4E8F0] bg-[#FBFCFE] p-3">
              <label className="text-muted-2 mb-1 block font-mono text-[10.5px] tracking-[0.06em] uppercase">
                What should the team change?
              </label>
              <textarea
                value={revisionNote}
                onChange={(e) => setRevisionNote(e.target.value.slice(0, PORTAL_FEEDBACK_BODY_MAX))}
                rows={3}
                placeholder="Optional — a specific note helps the editor know where to focus."
                className="w-full resize-y rounded-md border border-[#E4E8F0] bg-white px-3 py-2 font-sans text-[13px] leading-[1.5] text-[#1A2A4A] outline-none focus:border-[#3A5BA0]"
              />
              <div className="mt-[6px] flex items-center justify-between gap-2">
                <span className="text-muted-2 font-mono text-[10.5px] tabular-nums">
                  {revisionNote.length}/{PORTAL_FEEDBACK_BODY_MAX}
                </span>
                <button
                  type="button"
                  onClick={requestRevision}
                  disabled={pending}
                  className="rounded-md px-[10px] py-[5px] font-sans text-[12px] font-semibold text-white transition-[filter] disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: "#5A6473" }}
                >
                  {pending ? "Sending…" : "Send revision request"}
                </button>
              </div>
            </div>
          )}

          {state.kind === "error" && (
            <div className="mt-2 text-[12px] text-[#A03030]">{state.message}</div>
          )}
        </>
      )}
    </div>
  );
}

function reasonToMessage(
  reason: "invalid_token" | "throttled" | "not_pending" | "not_found",
): string {
  switch (reason) {
    case "invalid_token":
      return "This portal link is no longer valid. Ask your agency for a fresh one.";
    case "throttled":
      return "That's a lot of activity — take a breath and try again in a bit.";
    case "not_pending":
      return "This item is no longer pending your approval. Refresh the page to see the latest state.";
    case "not_found":
      return "This item is no longer available. Ask your agency if you're not sure why.";
  }
}
