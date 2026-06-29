"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ClientFormModal } from "@/components/clients/client-form-modal";
import { ShowFormModal, type ShowClientOption } from "@/components/shows/show-form-modal";

/**
 * Dashboard empty-state for brand-new agencies. Adapts to the hierarchy
 * state:
 *   - 0 clients → "Add a client" (clients are the parent customers).
 *   - 1+ clients, 0 shows → "Add a show under {firstClientName}".
 *   - 1+ shows → normal dashboard (this component isn't rendered).
 *
 * Replaces the normal KPI / chart layout until at least one show exists,
 * since every tile + chart on the regular dashboard would otherwise render
 * as a row of zeros.
 */
export function GetStarted({
  agencyName,
  firstName,
  clientCount,
  showCount,
  clients,
}: {
  agencyName: string;
  firstName: string;
  clientCount: number;
  showCount: number;
  /** Available clients for the show modal's parent picker. */
  clients: ShowClientOption[];
}) {
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [showModalOpen, setShowModalOpen] = useState(false);
  const needsClient = clientCount === 0;
  const needsShow = !needsClient && showCount === 0;

  return (
    <div className="mx-auto max-w-[840px]">
      <div className="mb-7">
        <div
          className="mb-2 font-sans text-[11.5px] font-semibold tracking-[0.09em] uppercase"
          style={{ color: "#3A5BA0" }}
        >
          Welcome to {agencyName}
        </div>
        <h1
          className="font-display text-[26px] font-semibold tracking-[-0.5px] sm:text-[30px]"
          style={{ color: "#1A2A4A" }}
        >
          Let&apos;s get you to your first generated outputs, {firstName}.
        </h1>
        <p className="mt-2 max-w-[600px] text-[14px] leading-[1.55]" style={{ color: "#5A6473" }}>
          A few quick things to do — they don&apos;t have to happen in order. Start at the top and
          come back any time.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-3">
        <ActionCard
          step={1}
          tone={needsClient ? "primary" : "secondary"}
          done={!needsClient}
          title="Add your first client"
          body="Clients are the agencies or hosts you produce content for. Each client can own one or more podcast shows."
          ctaLabel={needsClient ? "Add a client" : "Add another"}
          icon={
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 17v-1.5A3.5 3.5 0 0 1 7.5 12h5a3.5 3.5 0 0 1 3.5 3.5V17" />
              <circle cx="10" cy="7" r="3" />
            </svg>
          }
          onClick={() => setClientModalOpen(true)}
        />

        <ActionCard
          step={2}
          tone={needsShow ? "primary" : "secondary"}
          done={!needsClient && !needsShow}
          title="Add a show"
          body="Each show is one podcast. The voice engine tunes to each show's host individually."
          ctaLabel={needsClient ? "Add a client first" : "Add a show"}
          icon={
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="14" height="11" rx="2" />
              <path d="M3 8h14M7 11h6" />
            </svg>
          }
          disabled={needsClient}
          disabledHint="Add a client first"
          onClick={() => setShowModalOpen(true)}
        />

        <ActionCard
          step={3}
          tone="secondary"
          title="Generate your first episode"
          body="Paste a transcript and we'll spin up every platform output in your host's voice."
          ctaLabel="Open the wizard"
          icon={
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 2.5L4 11h5l-1 6.5L16 9h-5z" />
            </svg>
          }
          disabled={needsClient || needsShow}
          disabledHint={needsClient ? "Add a client + show first" : "Add a show first"}
          href="/episodes/new"
        />
      </div>

      <div
        className="mt-7 rounded-[14px] p-4 text-[12.5px]"
        style={{
          background: "#FFFFFF",
          border: "1px solid #E6EBF3",
          color: "#5A6473",
        }}
      >
        <div className="mb-1 flex items-center gap-2">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="#3A5BA0"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="7" cy="7" r="5.5" />
            <path d="M7 4.5v3M7 9.5v.01" />
          </svg>
          <span
            className="font-sans text-[12px] font-semibold tracking-[0.06em] uppercase"
            style={{ color: "#1A2A4A" }}
          >
            Tip
          </span>
        </div>
        Once you&apos;ve approved a handful of outputs, the voice engine locks in. Until then,
        expect light edits on the first batch — that&apos;s normal, and every approval teaches it.
      </div>

      <ClientFormModal
        mode="create"
        open={clientModalOpen}
        onClose={() => setClientModalOpen(false)}
      />
      <ShowFormModal
        mode="create"
        clients={clients}
        defaultClientId={clients[0]?.id}
        open={showModalOpen}
        onClose={() => setShowModalOpen(false)}
      />
    </div>
  );
}

type Tone = "primary" | "secondary";

function ActionCard({
  step,
  tone,
  title,
  body,
  ctaLabel,
  icon,
  href,
  onClick,
  disabled,
  disabledHint,
  done,
}: {
  step: number;
  tone: Tone;
  title: string;
  body: string;
  ctaLabel: string;
  icon: ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  disabledHint?: string;
  done?: boolean;
}) {
  const accent = tone === "primary";

  const content = (
    <div
      className="group relative flex h-full flex-col rounded-[16px] p-5 text-left transition-all"
      style={{
        background: disabled ? "#FBFCFE" : accent ? "#F7F9FE" : "#FFFFFF",
        border: `1.5px solid ${disabled ? "#E6EBF3" : accent ? "#3A5BA0" : "#E6EBF3"}`,
        boxShadow: disabled
          ? "none"
          : accent
            ? "0 8px 24px rgba(58,91,160,0.16)"
            : "0 1px 2px rgba(26,42,74,0.04)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <span
          className="flex h-[36px] w-[36px] items-center justify-center rounded-[10px]"
          style={{
            background: done ? "#E7F4EC" : accent ? "#3A5BA0" : "#EEF2FB",
            color: done ? "#1E7A47" : accent ? "#FFFFFF" : "#3A5BA0",
          }}
        >
          {done ? (
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 9.5l4 4 8-8" />
            </svg>
          ) : (
            icon
          )}
        </span>
        <span
          className="font-sans text-[11px] font-semibold tracking-[0.08em] uppercase"
          style={{ color: done ? "#1E7A47" : "#A0A9B8" }}
        >
          {done ? "Done" : `Step ${step}`}
        </span>
      </div>
      <h3
        className="font-display text-[16px] leading-tight font-semibold"
        style={{ color: "#1A2A4A" }}
      >
        {title}
      </h3>
      <p
        className="mt-2 mb-4 flex-1 font-sans text-[12.5px] leading-[1.55]"
        style={{ color: "#5A6473" }}
      >
        {body}
      </p>
      <div
        className="flex items-center gap-1 font-sans text-[12.5px] font-semibold"
        style={{ color: disabled ? "#A0A9B8" : "#3A5BA0" }}
      >
        {disabled ? disabledHint : ctaLabel}
        {!disabled && (
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-transform group-hover:translate-x-[2px]"
          >
            <path d="M5 3l4 3.5L5 10" />
          </svg>
        )}
      </div>
    </div>
  );

  if (disabled) return content;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="block text-left">
        {content}
      </button>
    );
  }
  if (href) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    );
  }
  return content;
}
