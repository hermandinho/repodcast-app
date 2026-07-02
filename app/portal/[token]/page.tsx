import { notFound } from "next/navigation";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { OutputStatus, Platform } from "@prisma/client";
import {
  getPortalLinkByToken,
  listPortalDeliverables,
  logPortalAccess,
  type PortalDeliverableRow,
} from "@/server/db/client-portal";
import {
  listSharedStatementsForClient,
  type PortalStatementRow,
} from "@/server/db/client-statements";
import { platforms, type PlatformKey } from "@/lib/sample-data/platforms";
import { PortalOutputCard } from "@/components/portal/output-card";

/**
 * Phase 3.8 — public client portal.
 *
 * Auth is the token in the URL — see `middleware.ts` for the public
 * matcher. `getPortalLinkByToken` rejects missing / revoked / expired
 * links by returning null; we then 404 so a probing visitor can't tell
 * which of the three cases tripped (no signal exfiltration on token
 * existence).
 *
 * Access logging is fire-and-forget — a failed insert must never break
 * the read. The IP is sha-256 hashed before persistence so we can spot
 * bursts without storing raw addresses.
 *
 * Branding cascade: the agency's `brandLogoUrl` + `brandAccentColor` from
 * 2.5's branding settings drive the header, status chips, and CTA accent.
 * Falls back to neutral defaults when either is unset.
 *
 * Layout (redesigned 3.8):
 *   - Branded header (agency logo + client name)
 *   - Summary strip — approved / scheduled / published counts, last 30 days
 *   - Show → episode → output cards, ordered by most recent lifecycle event
 *   - Each output card is interactive (client component) with a status
 *     chip, copy button, view-on-platform link, and inline feedback form
 */

export const dynamic = "force-dynamic";

const PLATFORM_TO_UI_KEY: Record<Platform, PlatformKey> = {
  TWITTER: "x",
  LINKEDIN: "li",
  INSTAGRAM: "ig",
  TIKTOK: "tt",
  SHOW_NOTES: "notes",
  BLOG: "blog",
  NEWSLETTER: "news",
};

const platformByKey = new Map<PlatformKey, (typeof platforms)[number]>(
  platforms.map((p) => [p.key, p]),
);

const DEFAULT_ACCENT = "#3A5BA0";

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await getPortalLinkByToken(token);
  if (!link) {
    // Single 404 surface for missing / revoked / expired — no signal on
    // which state tripped.
    notFound();
  }

  // Header-derived access metadata. `headers()` is a server-side request
  // accessor in Next 16 — works inside a server component.
  const h = await headers();
  const rawIp = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
  const ipHash = rawIp ? createHash("sha256").update(rawIp).digest("hex") : null;
  const userAgent = h.get("user-agent") ?? null;
  // Fire-and-forget so a logging blip never breaks the read.
  void logPortalAccess(link.id, { ipHash, userAgent });

  const [deliverables, statements] = await Promise.all([
    listPortalDeliverables(link.clientId),
    listSharedStatementsForClient(link.clientId),
  ]);
  const grouped = groupByShowAndEpisode(deliverables);

  const agency = link.client.agency;
  const accent = agency.brandAccentColor ?? DEFAULT_ACCENT;

  const summary = summarize(deliverables);

  // Belt-and-braces: `optionalUrl` in the billing repo already rejects
  // non-http(s) URLs on write, but a row saved before that guard shipped
  // could still contain `javascript:` / `data:`. Re-verify at render time.
  const rawPayLink = link.client.billingProfile?.paymentLinkUrl ?? null;
  const payLinkUrl = rawPayLink && /^https?:\/\//i.test(rawPayLink) ? rawPayLink : null;

  return (
    <div className="mx-auto max-w-[920px] px-6 py-10">
      {/* Branded header. Logo (or accent initials) + client name +
          expiry note. Keeps chrome minimal — the summary strip below
          carries the actual signal. */}
      <header className="mb-6 flex items-center gap-4">
        {agency.brandLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={agency.brandLogoUrl}
            alt={`${agency.name} logo`}
            className="h-12 w-12 flex-shrink-0 rounded-lg object-cover"
            style={{ background: "#EEF1F6" }}
          />
        ) : (
          <div
            className="font-display flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg text-[16px] font-semibold text-white"
            style={{ background: accent }}
          >
            {agency.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-muted-2 font-mono text-[10.5px] font-medium tracking-[0.08em] uppercase">
            {agency.name}
          </div>
          <h1 className="font-display text-ink mt-[2px] text-[24px] font-semibold tracking-[-0.01em]">
            {link.client.name}
          </h1>
          <div className="text-muted-2 mt-[3px] font-sans text-[12.5px]">
            Link active through {DATE_FMT.format(link.expiresAt)}
          </div>
        </div>
        {/* Money CTA — hands off to whatever payment URL the agency
            configured (Stripe payment-link, custom checkout, etc.).
            `rel="noopener"` because the hop is off-domain. */}
        {payLinkUrl && (
          <a
            href={payLinkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 rounded-lg px-4 py-[10px] font-sans text-[13px] font-semibold text-white no-underline transition-[filter] hover:brightness-95"
            style={{ background: accent }}
          >
            Make a payment ↗
          </a>
        )}
      </header>

      {/* Summary strip — three counters covering the full lifecycle.
          Uses `border-r` dividers between cells so the row reads as a
          single grouped stat rather than three isolated cards. */}
      <section className="border-border bg-surface shadow-card mb-8 grid grid-cols-3 divide-x divide-[#EEF1F6] overflow-hidden rounded-2xl border">
        <SummaryCell
          label="Published"
          value={summary.published}
          hint="Live on your channels"
          accent={accent}
        />
        <SummaryCell
          label="Scheduled"
          value={summary.scheduled}
          hint="Queued to go out"
          accent={accent}
        />
        <SummaryCell
          label="Approved"
          value={summary.approved}
          hint="Signed off, awaiting scheduling"
          accent={accent}
        />
      </section>

      {grouped.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-8">
          {grouped.map((show) => (
            <section key={show.showId}>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-display text-ink text-[17px] font-semibold tracking-[-0.005em]">
                  {show.showName}
                </h2>
                <span className="text-muted-2 font-mono text-[10.5px] tracking-[0.05em] uppercase">
                  {show.host} · {show.episodes.length} episode
                  {show.episodes.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="flex flex-col gap-4">
                {show.episodes.map((ep) => (
                  <article
                    key={ep.episodeId}
                    className="border-border bg-surface shadow-card overflow-hidden rounded-2xl border"
                  >
                    <header className="border-border border-b px-5 py-4">
                      <div className="font-display text-ink text-[15px] font-semibold">
                        {ep.episodeTitle}
                      </div>
                      {ep.recordedAt && (
                        <div className="text-muted-2 mt-[2px] font-mono text-[10.5px] tracking-[0.04em] uppercase">
                          Recorded {DATE_FMT.format(ep.recordedAt)}
                        </div>
                      )}
                    </header>
                    <div className="flex flex-col">
                      {ep.outputs.map((o) => {
                        const meta = platformByKey.get(PLATFORM_TO_UI_KEY[o.platform]);
                        return (
                          <PortalOutputCard
                            key={o.id}
                            outputId={o.id}
                            token={token}
                            platformName={meta?.fullName ?? o.platform}
                            platformBadge={meta?.badge ?? "?"}
                            platformBadgeBg={meta?.badgeBg ?? "#EEF1F6"}
                            platformBadgeColor={meta?.badgeColor ?? "#1A2A4A"}
                            platformBadgeBorder={meta?.badgeBorder ?? "#E4E8F0"}
                            status={o.status as "APPROVED" | "SCHEDULED" | "PUBLISHED"}
                            approvedAtIso={o.approvedAt?.toISOString() ?? null}
                            scheduledForIso={o.scheduledFor?.toISOString() ?? null}
                            publishedAtIso={o.publishedAt?.toISOString() ?? null}
                            externalPostUrl={o.externalPostUrl}
                            content={o.content}
                            accentColor={accent}
                          />
                        );
                      })}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {statements.length > 0 && (
        <StatementsSection statements={statements} token={token} accent={accent} />
      )}

      {/* Footer — muted brand line, no sales language. */}
      <footer className="text-muted-2 mt-12 text-center font-mono text-[10.5px] tracking-[0.05em] uppercase">
        Delivered by {agency.name}
      </footer>
    </div>
  );
}

function StatementsSection({
  statements,
  token,
  accent,
}: {
  statements: PortalStatementRow[];
  token: string;
  accent: string;
}) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-ink text-[17px] font-semibold tracking-[-0.005em]">
          Statements
        </h2>
        <span className="text-muted-2 font-mono text-[10.5px] tracking-[0.05em] uppercase">
          {statements.length} on file
        </span>
      </div>
      <div className="border-border bg-surface shadow-card overflow-hidden rounded-2xl border">
        {statements.map((s, i) => (
          <div
            key={s.id}
            className={`flex flex-wrap items-center gap-4 px-5 py-4 ${
              i > 0 ? "border-t border-[#EEF1F6]" : ""
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="font-display text-ink text-[14px] font-semibold">
                {DATE_FMT.format(s.periodStart)} → {DATE_FMT.format(s.periodEnd)}
              </div>
              <div className="text-muted-2 mt-[3px] font-sans text-[11.5px]">
                {s.episodeCount} episode
                {s.episodeCount === 1 ? "" : "s"} · {s.outputCount} output
                {s.outputCount === 1 ? "" : "s"} · {s.approvalRatePct}% approval rate
              </div>
            </div>
            <a
              href={`/api/portal/${token}/statements/${s.id}/pdf`}
              className="font-sans text-[12.5px] font-semibold no-underline"
              style={{ color: accent }}
              download
            >
              Download PDF ↓
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}

function SummaryCell({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number;
  hint: string;
  accent: string;
}) {
  return (
    <div className="px-5 py-4">
      <div className="text-muted-2 font-mono text-[10.5px] font-medium tracking-[0.06em] uppercase">
        {label}
      </div>
      <div
        className="font-display mt-1 text-[28px] leading-none font-semibold tabular-nums"
        style={{ color: value > 0 ? accent : "#8B95A6" }}
      >
        {value}
      </div>
      <div className="text-muted-2 mt-[6px] font-sans text-[11.5px] leading-[1.4]">{hint}</div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border-border bg-surface rounded-2xl border border-dashed px-6 py-16 text-center">
      <div className="font-display text-ink text-[15px] font-semibold">Nothing here yet</div>
      <p className="text-muted mx-auto mt-2 max-w-[400px] text-[13px] leading-[1.5]">
        Your agency hasn&apos;t signed off on any content for this account yet. Deliverables will
        appear here as soon as they&apos;re approved.
      </p>
    </div>
  );
}

type GroupedShow = {
  showId: string;
  showName: string;
  host: string;
  episodes: {
    episodeId: string;
    episodeTitle: string;
    recordedAt: Date | null;
    outputs: PortalDeliverableRow[];
  }[];
};

/**
 * Bucket the flat deliverable list into show → episode → outputs so the
 * page renders as a hierarchy. Preserves the underlying "most recent
 * lifecycle event first" order — within each show/episode, the newest
 * activity floats up.
 */
function groupByShowAndEpisode(rows: PortalDeliverableRow[]): GroupedShow[] {
  const shows = new Map<string, GroupedShow>();
  for (const row of rows) {
    const showId = row.episode.show.id;
    let show = shows.get(showId);
    if (!show) {
      show = {
        showId,
        showName: row.episode.show.name,
        host: row.episode.show.host,
        episodes: [],
      };
      shows.set(showId, show);
    }
    let ep = show.episodes.find((e) => e.episodeId === row.episode.id);
    if (!ep) {
      ep = {
        episodeId: row.episode.id,
        episodeTitle: row.episode.title,
        recordedAt: row.episode.recordedAt,
        outputs: [],
      };
      show.episodes.push(ep);
    }
    ep.outputs.push(row);
  }
  return Array.from(shows.values());
}

function summarize(rows: PortalDeliverableRow[]): {
  approved: number;
  scheduled: number;
  published: number;
} {
  let approved = 0;
  let scheduled = 0;
  let published = 0;
  for (const r of rows) {
    if (r.status === OutputStatus.APPROVED) approved += 1;
    else if (r.status === OutputStatus.SCHEDULED) scheduled += 1;
    else if (r.status === OutputStatus.PUBLISHED) published += 1;
  }
  return { approved, scheduled, published };
}
