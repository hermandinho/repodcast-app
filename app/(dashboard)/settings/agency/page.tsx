import Link from "next/link";
import { MemberRole, Plan } from "@prisma/client";
import { AgencyNameForm } from "@/components/settings/agency-name-form";
import { RenewalRemindersToggle } from "@/components/settings/renewal-reminders-toggle";
import { PLAN_DISPLAY, priceFor } from "@/lib/plans";
import { asSupportedCurrency, DEFAULT_CURRENCY, formatPlanPrice } from "@/lib/currencies";
import { getAuthContext } from "@/server/auth/context";
import { isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

export default async function AgencySettingsPage() {
  const [tenant, auth] = await Promise.all([resolveTenantContext(), getAuthContext()]);

  // Pull live row when DB-backed; fall through to STUDIO defaults so the page
  // renders cleanly on a fresh clone (mirrors the billing page pattern).
  const live = isLiveDb();
  const agency = live
    ? await prisma.agency
        .findUnique({
          where: { id: tenant.agencyId },
          select: {
            id: true,
            name: true,
            plan: true,
            createdAt: true,
            renewalRemindersEnabled: true,
            preferredCurrency: true,
          },
        })
        .catch(() => null)
    : null;

  const memberCount = live
    ? await prisma.member.count({ where: { agencyId: tenant.agencyId } }).catch(() => 0)
    : 0;

  const name = agency?.name ?? auth?.agency.name ?? "Northbeam Studio";
  const plan: Plan = agency?.plan ?? auth?.agency.plan ?? Plan.STUDIO;
  const createdAt = agency?.createdAt ?? null;
  const planMeta = PLAN_DISPLAY[plan];
  const role = auth?.member.role ?? MemberRole.OWNER;
  const canEdit = role === MemberRole.OWNER || role === MemberRole.ADMIN;

  return (
    <>
      {/* Identity card */}
      <div className="border-border bg-surface shadow-card mb-[18px] rounded-3xl border p-5">
        <div className="mb-4">
          <div className="text-muted-2 font-sans text-[11.5px] font-semibold tracking-[0.06em] uppercase">
            Workspace
          </div>
          <div className="font-display text-ink mt-1 text-[20px] font-semibold">{name}</div>
        </div>
        <AgencyNameForm initial={name} canEdit={canEdit} />
      </div>

      {/* Plan summary — links out to billing for changes */}
      <div className="border-border bg-surface shadow-card mb-[18px] rounded-3xl border p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-muted-2 font-sans text-[11.5px] font-semibold tracking-[0.06em] uppercase">
              Current plan
            </div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="font-display text-ink text-[20px] font-semibold">
                {planMeta.name}
              </span>
              <span className="text-muted font-sans text-[13px]">
                {(() => {
                  const c = asSupportedCurrency(agency?.preferredCurrency) ?? DEFAULT_CURRENCY;
                  return `${formatPlanPrice(priceFor(plan, c), c)}/mo`;
                })()}
              </span>
            </div>
            <p className="text-muted mt-1 text-[13px]">{planMeta.tagline}</p>
          </div>
          <Link
            href="/settings/billing"
            className="border-border text-ink hover:bg-canvas inline-flex items-center gap-[6px] rounded-lg border bg-white px-3 py-[8px] font-sans text-[12.5px] font-semibold transition-colors"
          >
            Change plan
            <svg
              width="12"
              height="12"
              viewBox="0 0 13 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 3l4 3.5L5 10" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Phase 2.13.6 — renewals-reminder cron mute toggle. OWNER/ADMIN
          only; non-admins see a read-only summary. */}
      <div className="border-border bg-surface shadow-card mb-[18px] rounded-3xl border p-5">
        <div className="mb-3">
          <div className="text-muted-2 font-sans text-[11.5px] font-semibold tracking-[0.06em] uppercase">
            Notifications
          </div>
          <div className="font-display text-ink mt-1 text-[16px] font-semibold">
            Renewal reminders
          </div>
          <p className="text-muted mt-1 max-w-[640px] text-[12.5px] leading-[1.55]">
            Get an email when a client&apos;s contract renews — once at 30 days out, once at 7 days
            out. Sent to every owner and admin.
          </p>
        </div>
        <RenewalRemindersToggle
          initialEnabled={agency?.renewalRemindersEnabled ?? true}
          canEdit={canEdit}
        />
      </div>

      {/* Read-only facts — bordered grid */}
      <div
        className="border-border bg-surface shadow-card grid overflow-hidden rounded-3xl border"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
      >
        <Fact label="Members">
          <span className="font-display text-ink text-[18px] font-semibold">{memberCount}</span>
          <Link
            href="/settings/team"
            className="text-accent ml-2 font-sans text-[12px] font-semibold hover:underline"
          >
            Manage →
          </Link>
        </Fact>
        <Fact label="Created">
          <span className="text-ink text-[13.5px]">
            {createdAt ? DATE_FMT.format(createdAt) : "—"}
          </span>
        </Fact>
        <Fact label="Workspace ID">
          <code className="bg-canvas text-muted rounded px-2 py-[2px] font-mono text-[11.5px]">
            {agency?.id ?? tenant.agencyId}
          </code>
        </Fact>
      </div>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-border border-r p-5 last:border-r-0">
      <div className="text-muted-2 mb-2 font-sans text-[11.5px] font-semibold tracking-[0.06em] uppercase">
        {label}
      </div>
      <div className="flex items-center">{children}</div>
    </div>
  );
}
