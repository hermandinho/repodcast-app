import Link from "next/link";

import { requireSystemAdminContext } from "@/server/auth/system";
import { EMAILS, groupEmailsByJourney, type EmailEntry, type EmailTriggerType } from "./registry";

export const dynamic = "force-dynamic";

export default async function RootEmailsPage() {
  await requireSystemAdminContext();
  const groups = groupEmailsByJourney();
  const totalByType = summarizeByTriggerType(EMAILS);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
          Email journeys
        </h1>
        <p className="max-w-3xl text-sm text-zinc-400">
          Every transactional email the app sends, grouped by the moment it fires. Templates preview
          from static fixture data — no live data is read, so this page is safe to scroll on
          production. Auth emails (magic link, MFA, user-initiated password reset) are handled by
          Clerk and are not listed here.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Templates" value={EMAILS.length.toString()} hint="Preview-ready" />
        <StatCard
          label="Event-driven"
          value={totalByType.webhook.toString()}
          hint="Stripe / Inngest webhooks"
        />
        <StatCard
          label="Cron-driven"
          value={totalByType.cron.toString()}
          hint="Onboarding + trial + renewals"
        />
        <StatCard
          label="Manual"
          value={totalByType.manual.toString()}
          hint="Team invites + /root actions"
        />
      </section>

      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-lg font-semibold text-white">{group.title}</h2>
              <p className="text-[12.5px] text-zinc-500">{group.blurb}</p>
            </div>
            <span className="shrink-0 font-mono text-[10.5px] tracking-wider text-zinc-500 uppercase">
              {group.entries.length}
              {group.entries.length === 1 ? " email" : " emails"}
            </span>
          </div>
          <ul className="flex flex-col gap-2">
            {group.entries.map((entry) => (
              <EntryRow key={entry.slug} entry={entry} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function EntryRow({ entry }: { entry: EmailEntry }) {
  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-900/40 transition-colors hover:border-zinc-700 hover:bg-zinc-900/60">
      <Link
        href={`/root/emails/${entry.slug}`}
        className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <TriggerPill type={entry.trigger.type} />
            <span className="font-display text-[14.5px] font-semibold text-white">
              {entry.name}
            </span>
          </div>
          <div className="font-mono text-[11.5px] text-zinc-500">
            <span className="text-zinc-400">Subject:</span> {entry.subject}
          </div>
          <div className="text-[12.5px] text-zinc-400">{entry.purpose}</div>
        </div>
        <div className="grid grid-cols-1 gap-1 text-[11.5px] text-zinc-500 md:min-w-[280px] md:text-right">
          <MetaLine label="Fires" value={entry.trigger.label} />
          <MetaLine label="Sends to" value={entry.recipient.label} />
        </div>
      </Link>
    </li>
  );
}

function MetaLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-start gap-x-2 md:justify-end">
      <span className="font-mono text-[10.5px] tracking-wider text-zinc-600 uppercase">
        {label}
      </span>
      <span className="text-zinc-400">{value}</span>
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

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="font-mono text-[10.5px] tracking-wider text-zinc-500 uppercase">{label}</div>
      <div className="font-display mt-1.5 text-xl font-semibold tracking-tight text-white tabular-nums">
        {value}
      </div>
      <div className="mt-1 text-[11px] text-zinc-500">{hint}</div>
    </div>
  );
}

function summarizeByTriggerType(entries: readonly EmailEntry[]) {
  return entries.reduce(
    (acc, e) => {
      acc[e.trigger.type] += 1;
      return acc;
    },
    { webhook: 0, cron: 0, manual: 0 } as Record<EmailTriggerType, number>,
  );
}
