import { notFound } from "next/navigation";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { Platform } from "@prisma/client";
import {
  getPortalLinkByToken,
  listApprovedDeliverablesForPortal,
  logPortalAccess,
  type PortalDeliverableRow,
} from "@/server/db/client-portal";
import { platforms, type PlatformKey } from "@/lib/sample-data/platforms";

/**
 * Phase 2.5 — public client portal.
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
 * 2.5's branding settings drive the header + CTA accent inline. Falls
 * back to neutral defaults when either is unset.
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

  const deliverables = await listApprovedDeliverablesForPortal(link.clientId);
  const grouped = groupByShowAndEpisode(deliverables);

  const agency = link.client.agency;
  const accent = agency.brandAccentColor ?? DEFAULT_ACCENT;

  return (
    <div className="mx-auto max-w-[920px] px-6 py-10">
      {/* Branded header — logo OR initials avatar in accent color. */}
      <header className="mb-8 flex items-center gap-4">
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
        <div className="min-w-0">
          <div className="text-muted-2 font-sans text-[11.5px] font-semibold tracking-[0.06em] uppercase">
            Delivered by {agency.name}
          </div>
          <h1 className="font-display text-ink mt-[2px] text-[24px] font-semibold">
            {link.client.name}
          </h1>
          <div className="text-muted-2 mt-1 text-[12.5px]">
            Approved content for your show. Link expires {DATE_FMT.format(link.expiresAt)}.
          </div>
        </div>
      </header>

      {grouped.length === 0 ? (
        <div className="border-border bg-surface rounded-2xl border border-dashed px-6 py-12 text-center">
          <div className="font-display text-ink text-[15px] font-semibold">
            Nothing approved yet
          </div>
          <p className="text-muted mx-auto mt-2 max-w-[400px] text-[13px]">
            Your agency hasn&apos;t signed off on any outputs for this account yet. Check back once
            they&apos;ve approved an episode and the deliverables will appear here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {grouped.map((show) => (
            <section key={show.showId}>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="font-display text-ink text-[17px] font-semibold">{show.showName}</h2>
                <span className="text-muted-2 text-[12px]">
                  Hosted by {show.host} · {show.episodes.length} episode
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
                        <div className="text-muted-2 mt-[2px] text-[12px]">
                          Recorded {DATE_FMT.format(ep.recordedAt)}
                        </div>
                      )}
                    </header>
                    <div className="flex flex-col">
                      {ep.outputs.map((o, i) => {
                        const meta = platformByKey.get(PLATFORM_TO_UI_KEY[o.platform]);
                        return (
                          <div
                            key={o.id}
                            className="flex flex-col gap-[10px] px-5 py-4"
                            style={{
                              borderTop: i === 0 ? undefined : "1px solid #F0F3F8",
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-[10px]">
                                {meta && (
                                  <span
                                    className="font-display flex h-[26px] w-[26px] items-center justify-center rounded-md text-[11px] font-bold"
                                    style={{
                                      background: meta.badgeBg,
                                      color: meta.badgeColor,
                                      border: `1px solid ${meta.badgeBorder}`,
                                    }}
                                  >
                                    {meta.badge}
                                  </span>
                                )}
                                <div className="text-ink font-sans text-[13px] font-semibold">
                                  {meta?.fullName ?? o.platform}
                                </div>
                              </div>
                              {o.approvedAt && (
                                <span
                                  className="rounded-pill px-[9px] py-[3px] font-sans text-[11px] font-semibold"
                                  style={{
                                    background: `${accent}1A`,
                                    color: accent,
                                  }}
                                >
                                  Approved {DATE_FMT.format(o.approvedAt)}
                                </span>
                              )}
                            </div>
                            <div className="bg-canvas max-h-[260px] overflow-y-auto rounded-[10px] p-3 font-sans text-[13px] leading-[1.6] whitespace-pre-wrap text-[#39435A]">
                              {o.content}
                            </div>
                          </div>
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

      <footer className="text-muted-2 mt-10 text-center text-[11.5px]">
        Read-only delivery view · powered by {agency.name}
      </footer>
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
 * page renders as a hierarchy. Preserves the underlying "newest approved
 * first" order — the first show is the one that received the most recent
 * approval, and within each show the most recently approved episode is
 * first. Within an episode we keep the deliverable order from the query.
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
