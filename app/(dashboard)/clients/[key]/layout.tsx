import Link from "next/link";
import { notFound } from "next/navigation";
import { MemberRole } from "@prisma/client";
import { ClientDetailActions } from "@/components/clients/client-detail-actions";
import { ClientTabNav } from "@/components/clients/client-tab-nav";
import { getClientForUI, listShowsForClientUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";

/**
 * Shared chrome for `/clients/[key]/...`: back link, header card, and the
 * Overview / Deliverables & Billing tab nav. Per-tab content is rendered
 * by the child `page.tsx` files.
 *
 * Each tab's page also fetches the Client (for its own data needs); Prisma
 * does its own query-level dedup, and the row is small enough that the
 * second fetch is in the noise. If we ever need to tighten this we can
 * wrap `getClientForUI` in `react.cache()`.
 */
export default async function ClientLayout({
  params,
  children,
}: {
  params: Promise<{ key: string }>;
  children: React.ReactNode;
}) {
  const { key } = await params;
  const tenant = await resolveTenantContext();
  const client = await getClientForUI(tenant, key);
  if (!client) notFound();

  // Stat strip aggregates — fetched once at the layout level. The page
  // already runs its own `listShowsForClientUI`; Prisma dedup + the small
  // row count make the duplicate read negligible.
  const shows = await listShowsForClientUI(tenant, client.key);
  const totalEpisodes = shows.reduce((sum, s) => sum + s.episodeCount, 0);
  const totalSamples = shows.reduce((sum, s) => sum + s.samples, 0);
  const strongShows = shows.filter((s) => s.samples >= 16).length;

  const isAdminOrOwner = tenant.role === MemberRole.OWNER || tenant.role === MemberRole.ADMIN;

  return (
    <div className="px-[30px] py-[28px] pb-[60px]">
      <Link
        href="/clients"
        className="text-muted hover:text-ink mb-4 inline-flex items-center gap-[6px] font-sans text-[12.5px] font-medium transition-colors"
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 13 13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 3L4 6.5l4 3.5" />
        </svg>
        All clients
      </Link>

      <div className="border-border bg-surface mb-[18px] rounded-3xl border p-5">
        <div className="flex flex-wrap items-start gap-5">
          {client.artworkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={client.artworkUrl}
              alt=""
              className="h-[74px] w-[74px] flex-shrink-0 rounded-2xl object-cover"
              style={{ background: "#EEF1F6" }}
            />
          ) : (
            <div
              className="font-display flex h-[74px] w-[74px] flex-shrink-0 items-center justify-center rounded-2xl text-[26px] font-bold text-white"
              style={{
                background: client.avatarBg,
                boxShadow: "inset 0 -22px 36px rgba(0,0,0,.18)",
              }}
            >
              {client.initial}
            </div>
          )}

          <div className="min-w-[200px] flex-1">
            <h1 className="font-display text-ink text-[22px] font-semibold tracking-[-0.4px]">
              {client.name}
            </h1>
            {client.contactName && (
              <div className="text-muted mt-[5px] text-[13.5px]">
                {client.contactName}
                {client.contactEmail && (
                  <span className="text-muted-2"> · {client.contactEmail}</span>
                )}
              </div>
            )}
            {client.description && (
              <p className="text-muted mt-2 max-w-[640px] text-[13px] leading-[1.55]">
                {client.description}
              </p>
            )}
          </div>

          <ClientDetailActions
            clientId={client.key}
            initial={{
              name: client.name,
              description: client.description || null,
              contactName: client.contactName || null,
              contactEmail: client.contactEmail || null,
              artworkUrl: client.artworkUrl || null,
            }}
          />
        </div>

        <dl className="mt-5 grid gap-3 border-t border-[#F0F3F8] pt-4 sm:grid-cols-3">
          <StatBlock label="Shows" value={String(shows.length)} />
          <StatBlock label="Episodes" value={String(totalEpisodes)} />
          <StatBlock
            label="Voice samples"
            value={
              <span className="inline-flex flex-wrap items-baseline gap-x-[8px]">
                <span>{totalSamples}</span>
                {shows.length > 0 && (
                  <span className="text-muted-2 font-sans text-[12px] font-medium">
                    · {strongShows} of {shows.length} strong
                  </span>
                )}
              </span>
            }
          />
        </dl>
      </div>

      {/* Deliverables & Billing tab is open to all roles (the form
          sub-panel within is OWNER/ADMIN-only — EDITOR/REVIEWER see the
          deliverable ledger instead). Statements is OWNER/ADMIN-only —
          billing material. */}
      <ClientTabNav
        clientKey={key}
        showBillingTab
        showStatementsTab={isAdminOrOwner}
        showWorkflowTab={isAdminOrOwner}
      />

      {children}
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-2 font-sans text-[11px] font-semibold tracking-[0.06em] uppercase">
        {label}
      </dt>
      <dd className="text-ink mt-[6px] font-sans text-[13.5px] font-semibold">{value}</dd>
    </div>
  );
}
