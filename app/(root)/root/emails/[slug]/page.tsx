import Link from "next/link";
import { notFound } from "next/navigation";
import { render } from "@react-email/render";

import { requireSystemAdminContext } from "@/server/auth/system";
import {
  EMAIL_JOURNEYS,
  EMAILS,
  getEmailBySlug,
  type EmailEntry,
  type EmailTriggerType,
} from "../registry";

export const dynamic = "force-dynamic";

export default async function EmailPreviewPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireSystemAdminContext();
  const { slug } = await params;
  const entry = getEmailBySlug(slug);
  if (!entry) notFound();

  const html = await render(entry.element);
  // Encode as a data URL so the iframe is fully sandboxed from the /root chrome
  // — React Email templates carry their own inline CSS + font references and
  // shouldn't inherit anything from the admin shell.
  const iframeSrc = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  const journeyMeta = EMAIL_JOURNEYS[entry.journey];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/root/emails"
          className="w-fit font-mono text-[11px] tracking-wider text-zinc-500 uppercase hover:text-zinc-300"
        >
          ← All email journeys
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <TriggerPill type={entry.trigger.type} />
          <span className="rounded border border-zinc-800 bg-zinc-900/60 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-zinc-400 uppercase">
            {journeyMeta.title}
          </span>
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
          {entry.name}
        </h1>
        <p className="max-w-3xl text-sm text-zinc-400">{entry.purpose}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Preview column */}
        <section className="flex flex-col gap-3">
          <PreviewHeader subject={entry.subject} />
          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-white">
            <iframe
              // sandbox stops any accidental script execution or navigation
              // — React Email templates are plain HTML, this is belt-and-suspenders.
              sandbox=""
              title={`${entry.name} preview`}
              src={iframeSrc}
              className="block h-[820px] w-full border-0 bg-[#F4F6FA]"
            />
          </div>
          <p className="text-[11.5px] text-zinc-500">
            Rendered from{" "}
            <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[11px] text-zinc-300">
              {`server/email/templates/${entry.slug}.tsx`}
            </code>{" "}
            with static fixture data. The iframe is fully sandboxed and matches the raw HTML that
            Resend would deliver.
          </p>
        </section>

        {/* Metadata sidebar */}
        <aside className="flex flex-col gap-4">
          <MetaCard title="Trigger">
            <MetaRow label="Type">
              <span className="capitalize">{entry.trigger.type}</span>
            </MetaRow>
            <MetaRow label="Where">{entry.trigger.label}</MetaRow>
            <MetaRow label="Source">
              <code className="font-mono text-[11px] break-all text-zinc-300">
                {entry.trigger.source}
              </code>
            </MetaRow>
            <MetaRow label="Cadence">{entry.cadence}</MetaRow>
          </MetaCard>

          <MetaCard title="Recipient">
            <MetaRow label="Who">{entry.recipient.label}</MetaRow>
            <MetaRow label="Lookup">{entry.recipient.lookup}</MetaRow>
          </MetaCard>

          <MetaCard title="Delivery">
            <MetaRow label="Sender">
              <code className="font-mono text-[11px] text-zinc-300">{entry.senderFn}</code>
            </MetaRow>
            <MetaRow label="Subject">
              <span className="text-zinc-200">{entry.subject}</span>
            </MetaRow>
          </MetaCard>

          <MetaCard title="Why this email exists">
            <p className="text-[12.5px] leading-relaxed text-zinc-300">{entry.rationale}</p>
          </MetaCard>

          <PeerNav current={entry} />
        </aside>
      </div>
    </div>
  );
}

function PreviewHeader({ subject }: { subject: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
      <div className="font-mono text-[10px] tracking-wider text-zinc-500 uppercase">Subject</div>
      <div className="font-display text-[14.5px] text-white">{subject}</div>
    </div>
  );
}

function MetaCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h3 className="font-mono text-[10.5px] tracking-wider text-zinc-500 uppercase">{title}</h3>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[10px] tracking-wider text-zinc-500 uppercase">{label}</span>
      <span className="text-[12.5px] text-zinc-300">{children}</span>
    </div>
  );
}

function PeerNav({ current }: { current: EmailEntry }) {
  const peers = EMAILS.filter((e) => e.journey === current.journey && e.slug !== current.slug);
  if (peers.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <h3 className="font-mono text-[10.5px] tracking-wider text-zinc-500 uppercase">
        Other emails in this journey
      </h3>
      <ul className="flex flex-col gap-1">
        {peers.map((peer) => (
          <li key={peer.slug}>
            <Link
              href={`/root/emails/${peer.slug}`}
              className="block rounded-md px-2 py-1.5 text-[12.5px] text-zinc-300 hover:bg-zinc-800/60 hover:text-white"
            >
              {peer.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TRIGGER_STYLES: Record<EmailTriggerType, { label: string; className: string }> = {
  webhook: {
    label: "webhook",
    className: "border-sky-800/60 bg-sky-950/40 text-sky-200",
  },
  cron: {
    label: "cron",
    className: "border-emerald-800/60 bg-emerald-950/40 text-emerald-200",
  },
  manual: {
    label: "manual",
    className: "border-amber-800/60 bg-amber-950/30 text-amber-200",
  },
};

function TriggerPill({ type }: { type: EmailTriggerType }) {
  const style = TRIGGER_STYLES[type];
  return (
    <span
      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wider uppercase ${style.className}`}
    >
      {style.label}
    </span>
  );
}
