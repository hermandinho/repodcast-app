import Link from "next/link";
import { notFound } from "next/navigation";
import { BillingCycle, ClientStatus, MemberRole, OutputStatus, Platform } from "@prisma/client";
import { headers } from "next/headers";
import { ClientBillingForm } from "@/components/clients/client-billing-form";
import type { ClientBillingFormInitial } from "@/components/clients/client-billing-form";
import { CostToServeCard } from "@/components/clients/cost-to-serve-card";
import { DeliverableLedgerFilters } from "@/components/clients/deliverable-ledger-filters";
import { PortalLinksCard, type PortalLinkRow } from "@/components/clients/portal-links-card";
import { PlatformBadge } from "@/components/ui/platform-badge";
import { platforms } from "@/lib/sample-data/platforms";
import { getClientBillingProfile } from "@/server/db/client-billing";
import { listPortalLinks } from "@/server/db/client-portal";
import { costForClient } from "@/server/db/client-cost";
import { listDeliverablesForClient, type DeliverableRow } from "@/server/db/deliverables";
import { getClientForUI, isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";

/**
 * Deliverables & Billing tab. Three sub-panels:
 *   1. Billing profile form (OWNER/ADMIN only — 2.13.2)
 *   2. Cost-to-serve card placeholder (2.13.5)
 *   3. Deliverable ledger — 2.13.3, this commit
 *
 * Role gate: page is open to all roles. EDITOR/REVIEWER see the ledger
 * only; the form is conditionally rendered for OWNER/ADMIN. CSV export
 * tightens further to OWNER/ADMIN inside the export route.
 */

const PAGE_SIZE = 25;

function parsePage(raw: string | string[] | undefined): number {
  if (typeof raw !== "string") return 1;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseString(raw: string | string[] | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseDate(raw: string | string[] | undefined): Date | undefined {
  const s = parseString(raw);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

function parsePlatform(raw: string | string[] | undefined): Platform | undefined {
  const s = parseString(raw);
  if (!s) return undefined;
  return s in Platform ? (s as Platform) : undefined;
}

function parseStatus(raw: string | string[] | undefined): OutputStatus | undefined {
  const s = parseString(raw);
  if (!s) return undefined;
  return s in OutputStatus ? (s as OutputStatus) : undefined;
}

const STATUS_STYLES: Record<OutputStatus, { label: string; bg: string; color: string }> = {
  GENERATING: { label: "Generating", bg: "#EEF2FB", color: "#3A5BA0" },
  READY: { label: "Ready", bg: "#F1F4F9", color: "#7A8496" },
  IN_REVIEW: { label: "In review", bg: "#FBF1DE", color: "#A06D12" },
  APPROVED: { label: "Approved", bg: "#E7F4EC", color: "#1E7A47" },
  SCHEDULED: { label: "Scheduled", bg: "#F1F4F9", color: "#7A8496" },
  PUBLISHED: { label: "Published", bg: "#E7F4EC", color: "#1E7A47" },
  FAILED: { label: "Failed", bg: "#FBEDEC", color: "#C0392B" },
};

const platformByEnum = new Map(platforms.map((p) => [enumForKey(p.key), p]));

function enumForKey(key: string): Platform {
  switch (key) {
    case "x":
      return Platform.TWITTER;
    case "li":
      return Platform.LINKEDIN;
    case "ig":
      return Platform.INSTAGRAM;
    case "tt":
      return Platform.TIKTOK;
    case "notes":
      return Platform.SHOW_NOTES;
    case "blog":
      return Platform.BLOG;
    case "news":
      return Platform.NEWSLETTER;
    default:
      return Platform.LINKEDIN;
  }
}

function formatShortDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

export default async function ClientBillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { key } = await params;
  const sp = await searchParams;
  const tenant = await resolveTenantContext();
  const isAdminOrOwner = tenant.role === MemberRole.OWNER || tenant.role === MemberRole.ADMIN;

  const client = await getClientForUI(tenant, key);
  if (!client) notFound();

  // Sample-data mode: no DB. Render the form with empty defaults and the
  // ledger with an empty state so the design preview still shows layout.
  const profile =
    isLiveDb() && isAdminOrOwner ? await getClientBillingProfile(tenant, client.key) : null;

  // Cost-to-serve for this calendar month — admin-only (financial data).
  // Sample-data mode skips the query; the card no-ops on null.
  const costThisMonth =
    isLiveDb() && isAdminOrOwner ? await costForClient(tenant, client.key) : null;

  // Portal links for this client — visible to every role; mint/revoke
  // gated on OWNER/ADMIN inside the card itself.
  const portalLinks: PortalLinkRow[] = isLiveDb()
    ? (await listPortalLinks(tenant, client.key)).map((l) => ({
        id: l.id,
        token: l.token,
        expiresAtIso: l.expiresAt.toISOString(),
        revokedAtIso: l.revokedAt?.toISOString() ?? null,
        lastAccessedAtIso: l.lastAccessedAt?.toISOString() ?? null,
        createdByName: l.createdByMember?.name?.trim() || l.createdByMember?.email || null,
      }))
    : [];

  // Compose the share URL from the inbound request host so we don't have
  // to wire an env var; `NEXT_PUBLIC_APP_URL` wins when set so production
  // links use the canonical domain even when served behind a tunnel.
  const reqHeaders = await headers();
  const portalBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (() => {
      const proto = reqHeaders.get("x-forwarded-proto") ?? "https";
      const host = reqHeaders.get("host") ?? "localhost:3000";
      return `${proto}://${host}`;
    })();

  const initial: ClientBillingFormInitial = {
    billingContactName: profile?.billingContactName ?? "",
    billingContactEmail: profile?.billingContactEmail ?? "",
    retainerCents: profile?.retainerCents ?? null,
    ratePerEpisodeCents: profile?.ratePerEpisodeCents ?? null,
    billingCycle: profile?.billingCycle ?? BillingCycle.MONTHLY,
    currency: profile?.currency ?? "USD",
    contractStartDate: profile?.contractStartDate
      ? profile.contractStartDate.toISOString().slice(0, 10)
      : "",
    contractRenewalDate: profile?.contractRenewalDate
      ? profile.contractRenewalDate.toISOString().slice(0, 10)
      : "",
    status: profile?.status ?? ClientStatus.ACTIVE,
    paymentLinkUrl: profile?.paymentLinkUrl ?? "",
    internalNotes: profile?.internalNotes ?? "",
  };

  // Deliverable ledger query
  const page = parsePage(sp.page);
  const from = parseDate(sp.from);
  const to = parseDate(sp.to);
  const platform = parsePlatform(sp.platform);
  const status = parseStatus(sp.status);

  const ledger = isLiveDb()
    ? await listDeliverablesForClient(tenant, client.key, {
        from,
        to,
        platform,
        status,
        take: PAGE_SIZE,
        skip: (page - 1) * PAGE_SIZE,
      })
    : { rows: [] as DeliverableRow[], total: 0 };

  const totalPages = Math.max(1, Math.ceil(ledger.total / PAGE_SIZE));
  const isFiltered = Boolean(from || to || platform || status);

  // Preserve filter params on prev/next.
  const linkFor = (nextPage: number) => {
    const qp = new URLSearchParams();
    if (typeof sp.from === "string") qp.set("from", sp.from);
    if (typeof sp.to === "string") qp.set("to", sp.to);
    if (platform) qp.set("platform", platform);
    if (status) qp.set("status", status);
    if (nextPage > 1) qp.set("page", String(nextPage));
    const qs = qp.toString();
    return qs ? `/clients/${key}/billing?${qs}` : `/clients/${key}/billing`;
  };

  // CSV URL inherits the live filters; pagination is irrelevant for export.
  const csvParams = new URLSearchParams();
  if (typeof sp.from === "string") csvParams.set("from", sp.from);
  if (typeof sp.to === "string") csvParams.set("to", sp.to);
  if (platform) csvParams.set("platform", platform);
  if (status) csvParams.set("status", status);
  const csvHref = `/api/clients/${client.key}/deliverables${csvParams.toString() ? `?${csvParams}` : ""}`;

  const startN = ledger.total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endN = Math.min(ledger.total, page * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-5">
      {isAdminOrOwner && <ClientBillingForm clientId={client.key} initial={initial} />}

      {/* Cost-to-serve card (2.13.5). Admin-only — financial data. */}
      {isAdminOrOwner && (
        <CostToServeCard
          cost={costThisMonth}
          retainerCents={profile?.retainerCents ?? null}
          ratePerEpisodeCents={profile?.ratePerEpisodeCents ?? null}
          currency={profile?.currency ?? "USD"}
        />
      )}

      {/* Phase 2.5 — client portal links. Read-only for non-OWNER/ADMIN. */}
      <PortalLinksCard
        clientId={client.key}
        initialLinks={portalLinks}
        baseUrl={portalBaseUrl}
        canManage={isAdminOrOwner}
      />

      {/* Deliverable ledger */}
      <section className="border-border bg-surface rounded-3xl border p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="font-display text-ink text-[15px] font-semibold">
              Deliverable ledger
            </div>
            <div className="text-muted-2 mt-[3px] text-[12.5px]">
              {ledger.total === 0
                ? isFiltered
                  ? "No deliverables match these filters"
                  : "No deliverables yet for this client"
                : `${ledger.total} deliverable${ledger.total === 1 ? "" : "s"} · showing ${startN}–${endN}`}
            </div>
          </div>
        </div>

        <DeliverableLedgerFilters
          basePath={`/clients/${key}/billing`}
          csvHref={csvHref}
          csvDisabled={!isAdminOrOwner}
        />

        {ledger.rows.length === 0 ? (
          <div className="border-border bg-canvas text-muted-2 rounded-2xl border border-dashed px-4 py-8 text-center text-[12.5px]">
            {isFiltered
              ? "Adjust the filters or clear them to see more."
              : "Generated outputs for this client will appear here as the team approves them."}
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {ledger.rows.map((row) => (
                <DeliverableRowItem key={row.id} row={row} />
              ))}
            </ul>

            {totalPages > 1 && (
              <nav
                className="text-muted mt-4 flex items-center justify-between gap-3 text-[12.5px]"
                aria-label="Deliverables pagination"
              >
                <PageLink
                  href={linkFor(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  label="← Previous"
                />
                <span>
                  Page <span className="text-ink font-semibold">{page}</span> of {totalPages}
                </span>
                <PageLink
                  href={linkFor(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  label="Next →"
                />
              </nav>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function DeliverableRowItem({ row }: { row: DeliverableRow }) {
  const platform = platformByEnum.get(row.platform);
  const sm = STATUS_STYLES[row.status];
  const approver = row.approvedByMember
    ? row.approvedByMember.name?.trim() || row.approvedByMember.email
    : null;

  return (
    <li className="border-border bg-surface shadow-card flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-[12px]">
      {platform && <PlatformBadge platform={platform} size="sm" />}

      <Link
        href={`/episodes/${row.episode.id}`}
        className="text-ink hover:text-accent min-w-0 flex-1 truncate font-sans text-[13px] font-medium"
        title={row.episode.title}
      >
        {row.episode.title}
      </Link>

      <span
        className="rounded-pill inline-flex flex-shrink-0 items-center gap-[6px] px-[10px] py-1 font-sans text-[11px] font-semibold"
        style={{ background: sm.bg, color: sm.color }}
      >
        <span className="block h-[6px] w-[6px] rounded-full" style={{ background: sm.color }} />
        {sm.label}
      </span>

      <span className="text-muted-2 font-sans text-[11.5px]">
        Generated {formatShortDate(row.createdAt)}
      </span>

      {row.approvedAt && (
        <span className="text-muted-2 font-sans text-[11.5px]">
          {approver ? `Approved by ${approver} · ` : "Approved · "}
          {formatShortDate(row.approvedAt)}
        </span>
      )}
    </li>
  );
}

function PageLink({ href, disabled, label }: { href: string; disabled: boolean; label: string }) {
  if (disabled) {
    return (
      <span className="border-border bg-canvas text-muted-2 cursor-not-allowed rounded-md border px-3 py-2 text-[12.5px] font-medium opacity-50">
        {label}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="border-border text-muted hover:border-accent-border hover:text-accent rounded-md border bg-white px-3 py-2 text-[12.5px] font-medium transition-colors"
    >
      {label}
    </Link>
  );
}
