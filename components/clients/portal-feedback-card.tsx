"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  markPortalFeedbackReadAction,
  markPortalFeedbackUnreadAction,
} from "@/app/(dashboard)/clients/[key]/billing/portal-feedback-actions";

/**
 * Phase 3.8 — agency-side inbox for client portal feedback.
 *
 * Renders alongside `<PortalLinksCard>` on `/clients/[key]/billing`. Unread
 * feedback sits at the top with a soft accent bar; read items collapse
 * beneath a "Show read" toggle so the primary attention lands on what
 * still needs a human. Body text is line-wrapped verbatim (whitespace-pre)
 * because clients often send short lists.
 *
 * Actions:
 *   - Mark read / Mark unread — flip state in place via `useTransition`,
 *     then `router.refresh()` so the parent's `PortalFeedbackListItem[]`
 *     re-fetches and the row moves between sections.
 *   - Open output — links to `/episodes/[id]#[outputId]` when the target
 *     output still exists; shown as a muted "output no longer available"
 *     line when it's been deleted or superseded.
 */

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export type PortalFeedbackListItem = {
  id: string;
  createdAtIso: string;
  fromEmail: string | null;
  body: string;
  readAtIso: string | null;
  readByLabel: string | null;
  /** Was this feedback tied to a specific output? Preserved even when the
   *  target output has since been deleted / superseded. */
  hasOutputTarget: boolean;
  /** Populated when `hasOutputTarget` is true AND the output still exists. */
  output: {
    episodeId: string;
    episodeTitle: string;
    showName: string;
    platform: string;
  } | null;
};

export function PortalFeedbackCard({
  clientId,
  feedback,
}: {
  clientId: string;
  feedback: PortalFeedbackListItem[];
}) {
  const [showRead, setShowRead] = useState(false);

  const { unread, read } = useMemo(() => {
    const unreadRows: PortalFeedbackListItem[] = [];
    const readRows: PortalFeedbackListItem[] = [];
    for (const row of feedback) {
      if (row.readAtIso) readRows.push(row);
      else unreadRows.push(row);
    }
    return { unread: unreadRows, read: readRows };
  }, [feedback]);

  return (
    <section className="border-border bg-surface shadow-card rounded-3xl border p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="font-display text-ink flex items-center gap-2 text-[15px] font-semibold">
            Portal feedback
            {unread.length > 0 && (
              <span
                className="rounded-pill inline-flex items-center px-[8px] py-[2px] font-mono text-[10.5px] font-semibold tabular-nums"
                style={{ background: "rgba(58,91,160,0.14)", color: "#2A4A8A" }}
                aria-label={`${unread.length} unread`}
              >
                {unread.length} unread
              </span>
            )}
          </div>
          <div className="text-muted-2 mt-[3px] text-[12.5px]">
            Notes clients have sent from their portal link. Mark items read as you triage them.
          </div>
        </div>
      </div>

      {feedback.length === 0 ? (
        <div className="border-border bg-canvas text-muted-2 rounded-2xl border border-dashed px-4 py-8 text-center text-[12.5px]">
          No feedback yet. Once a client sends a note through their portal, it will land here.
        </div>
      ) : (
        <>
          {unread.length > 0 && (
            <ul className="flex flex-col gap-2">
              {unread.map((row) => (
                <FeedbackRow key={row.id} row={row} clientId={clientId} />
              ))}
            </ul>
          )}
          {read.length > 0 && (
            <div className={unread.length > 0 ? "mt-4" : ""}>
              <button
                type="button"
                onClick={() => setShowRead((v) => !v)}
                className="text-muted-2 hover:text-ink font-mono text-[10.5px] tracking-[0.06em] uppercase transition-colors"
                aria-expanded={showRead}
              >
                {showRead ? "Hide" : "Show"} {read.length} triaged
              </button>
              {showRead && (
                <ul className="mt-2 flex flex-col gap-2">
                  {read.map((row) => (
                    <FeedbackRow key={row.id} row={row} clientId={clientId} />
                  ))}
                </ul>
              )}
            </div>
          )}
          {unread.length === 0 && read.length > 0 && !showRead && (
            <div className="text-muted-2 py-3 text-center text-[12.5px]">
              Nothing new to triage — you&apos;re caught up.
            </div>
          )}
        </>
      )}
    </section>
  );
}

function FeedbackRow({ row, clientId }: { row: PortalFeedbackListItem; clientId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isRead = row.readAtIso !== null;

  const flip = () => {
    setError(null);
    startTransition(async () => {
      const action = isRead ? markPortalFeedbackUnreadAction : markPortalFeedbackReadAction;
      const res = await action({ feedbackId: row.id, clientId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <li
      className="rounded-2xl border p-4"
      style={{
        borderColor: isRead ? "#E4E8F0" : "#D8E1F3",
        background: isRead ? "var(--color-surface)" : "rgba(58,91,160,0.04)",
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          {!isRead && (
            <span
              aria-hidden
              className="mt-[6px] inline-block h-[7px] w-[7px] flex-shrink-0 self-start rounded-full"
              style={{ background: "#3A5BA0" }}
            />
          )}
          <div>
            <div className="text-ink font-sans text-[12.5px] font-semibold">
              {row.fromEmail ?? "Portal viewer"}
            </div>
            <div className="text-muted-2 font-mono text-[10.5px] tabular-nums">
              {DATE_FMT.format(new Date(row.createdAtIso))}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={flip}
          disabled={pending}
          className="text-muted hover:text-ink rounded-md px-[10px] py-[4px] font-sans text-[11.5px] font-medium transition-colors disabled:opacity-50"
          style={{ border: "1px solid #E4E8F0" }}
        >
          {pending ? "…" : isRead ? "Mark unread" : "Mark read"}
        </button>
      </div>

      <p className="text-ink mt-2 font-sans text-[13px] leading-[1.55] whitespace-pre-wrap">
        {row.body}
      </p>

      {row.output ? (
        <Link
          href={`/episodes/${row.output.episodeId}`}
          className="text-muted-2 hover:text-accent mt-2 inline-flex items-center gap-[6px] font-mono text-[10.5px] tracking-[0.04em] uppercase"
        >
          <span>On</span>
          <span className="text-ink font-sans text-[11.5px] font-medium tracking-normal normal-case">
            {row.output.showName} · {row.output.episodeTitle}
          </span>
          <span>·</span>
          <span>{row.output.platform.toLowerCase()}</span>
        </Link>
      ) : row.hasOutputTarget ? (
        <div className="text-muted-2 mt-2 font-mono text-[10.5px] tracking-[0.04em] uppercase">
          Original output no longer available
        </div>
      ) : (
        <div className="text-muted-2 mt-2 font-mono text-[10.5px] tracking-[0.04em] uppercase">
          General feedback
        </div>
      )}

      {isRead && row.readByLabel && (
        <div className="text-muted-2 mt-2 font-mono text-[10.5px] tracking-[0.04em] uppercase">
          Triaged by {row.readByLabel}
          {row.readAtIso ? ` · ${DATE_FMT.format(new Date(row.readAtIso))}` : ""}
        </div>
      )}

      {error && <div className="mt-2 text-[11.5px] text-[#A03030]">{error}</div>}
    </li>
  );
}
