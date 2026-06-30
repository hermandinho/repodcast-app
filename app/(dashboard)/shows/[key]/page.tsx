import Link from "next/link";
import { notFound } from "next/navigation";
import { PlatformBadge } from "@/components/ui/platform-badge";
import { StatusPill } from "@/components/ui/status-pill";
import { VoiceStrengthBars } from "@/components/ui/voice-strength-bars";
import { ShowDetailActions } from "@/components/shows/show-detail-actions";
import { getClientForUI, getShowForUI, getShowEditInitialForUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { platforms } from "@/lib/sample-data/platforms";
import { voiceLabel, voiceTextColor } from "@/lib/sample-data/voice-strength";

export default async function ShowDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const tenant = await resolveTenantContext();
  const [show, editInitial] = await Promise.all([
    getShowForUI(tenant, key),
    getShowEditInitialForUI(tenant, key),
  ]);
  if (!show) notFound();

  // Resolve the parent client for the breadcrumb. Optional — when the
  // lookup misses (cross-tenant, deleted, sample-mode quirk) the
  // breadcrumb degrades to just "Shows / {show.name}".
  const parentClient = await getClientForUI(tenant, show.clientKey);

  const label = voiceLabel(show.samples);
  const color = voiceTextColor(show.samples);
  const description = editInitial?.description?.trim() ?? "";
  const hasMoreEpisodes = show.episodeCount > show.episodes.length;
  const newEpisodeHref = `/episodes/new?showId=${encodeURIComponent(show.key)}`;
  const allEpisodesHref = `/episodes?show=${encodeURIComponent(show.key)}`;

  return (
    <div className="px-[30px] py-[28px] pb-[60px]">
      <nav
        aria-label="Breadcrumb"
        className="text-muted-2 mb-4 flex flex-wrap items-center gap-[6px] font-sans text-[12.5px]"
      >
        <Link href="/clients" className="hover:text-ink transition-colors">
          Clients
        </Link>
        <span className="text-[#C3CBD8]">/</span>
        {parentClient ? (
          <Link href={`/clients/${parentClient.key}`} className="hover:text-ink transition-colors">
            {parentClient.name}
          </Link>
        ) : (
          <span>—</span>
        )}
        <span className="text-[#C3CBD8]">/</span>
        <Link href="/shows" className="hover:text-ink transition-colors">
          Shows
        </Link>
        <span className="text-[#C3CBD8]">/</span>
        <span className="text-muted truncate">{show.name}</span>
      </nav>

      <div className="border-border bg-surface mb-[18px] rounded-3xl border p-5">
        <div className="flex flex-wrap items-start gap-5">
          {show.artworkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={show.artworkUrl}
              alt=""
              className="h-[74px] w-[74px] flex-shrink-0 rounded-2xl object-cover"
              style={{ background: "#EEF1F6" }}
            />
          ) : (
            <div
              className="font-display flex h-[74px] w-[74px] flex-shrink-0 items-center justify-center rounded-2xl text-[26px] font-bold text-white"
              style={{
                background: show.avatarBg,
                boxShadow: "inset 0 -22px 36px rgba(0,0,0,.18)",
              }}
            >
              {show.initial}
            </div>
          )}

          <div className="min-w-[200px] flex-1">
            <h1 className="font-display text-ink text-[22px] font-semibold tracking-[-0.4px]">
              {show.name}
            </h1>
            <div className="text-muted-2 mt-[5px] text-[13px]">Hosted by {show.host}</div>
          </div>

          <div className="flex flex-shrink-0 flex-wrap items-center gap-[10px]">
            <Link
              href={newEpisodeHref}
              className="bg-accent shadow-card inline-flex items-center gap-[7px] rounded-lg px-4 py-[11px] font-sans text-[13.5px] font-semibold text-white transition-[filter] hover:brightness-95"
              style={{ border: "1px solid rgba(0,0,0,.06)" }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M7 3v8M3 7h8" />
              </svg>
              Add episode
            </Link>

            <Link
              href={`/voice/${encodeURIComponent(show.key)}`}
              className="border-border text-muted hover:bg-canvas inline-flex items-center gap-[7px] rounded-lg border bg-white px-4 py-[10px] font-sans text-[13.5px] font-semibold transition-colors"
            >
              Voice profile
            </Link>

            {editInitial && <ShowDetailActions showId={show.key} initial={editInitial} />}
          </div>
        </div>

        <dl className="mt-5 grid gap-3 border-t border-[#F0F3F8] pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatBlock label="Episodes" value={String(show.episodeCount)} />
          <StatBlock
            label="Voice strength"
            value={
              <span className="inline-flex items-center gap-[8px]">
                <VoiceStrengthBars samples={show.samples} size="sm" />
                <span style={{ color }}>{label}</span>
                <span className="text-muted-2 font-sans text-[12px] font-medium">
                  · {show.samples}
                </span>
              </span>
            }
          />
          <StatBlock label="Last updated" value={show.lastActivity} />
          <StatBlock
            label="RSS feed"
            value={
              show.rssUrl ? (
                <a
                  href={show.rssUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent inline-flex max-w-full items-center gap-[6px] font-sans text-[13px] font-semibold hover:underline"
                  title={show.rssUrl}
                >
                  <span className="truncate">{prettyHost(show.rssUrl)}</span>
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M5 2H2v8h8V7" />
                    <path d="M7 2h3v3M10 2 5 7" />
                  </svg>
                </a>
              ) : (
                <span className="text-muted-2 font-sans text-[13px]">Not connected</span>
              )
            }
          />
        </dl>
      </div>

      {description && (
        <div className="border-border bg-surface mb-[18px] rounded-3xl border p-5">
          <div className="text-muted-2 font-sans text-[11px] font-semibold tracking-[0.06em] uppercase">
            About this show
          </div>
          <p className="text-ink mt-[8px] text-[13.5px] leading-[1.6] whitespace-pre-wrap">
            {description}
          </p>
        </div>
      )}

      <div className="grid items-start gap-[18px] md:grid-cols-2">
        <section className="border-border bg-surface rounded-3xl border p-5">
          <div className="font-display text-ink text-[15px] font-semibold">
            Voice strength by platform
          </div>
          <div className="text-muted-2 mt-[3px] mb-[18px] text-[12.5px]">
            Each platform trains on its own approved outputs.
          </div>
          {show.samples === 0 ? (
            <VoicePlatformEmpty showKey={show.key} />
          ) : (
            <div className="flex flex-col gap-[15px]">
              {platforms.map((p) => {
                const n = show.platformSamples[p.key] ?? 0;
                return (
                  <div key={p.key} className="flex items-center gap-3">
                    <PlatformBadge platform={p} />
                    <div className="min-w-0 flex-1">
                      <div className="mb-[6px] flex items-center justify-between">
                        <span className="text-[13px] font-medium text-[#39435A]">{p.name}</span>
                        <span
                          className="font-sans text-[11.5px] font-semibold"
                          style={{ color: voiceTextColor(n) }}
                        >
                          {voiceLabel(n)} · {n}
                        </span>
                      </div>
                      <VoiceStrengthBars samples={n} size="sm" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="border-border bg-surface rounded-3xl border px-5 pt-5 pb-2">
          <div className="mb-[6px] flex items-center justify-between">
            <div className="font-display text-ink text-[15px] font-semibold">Recent episodes</div>
            <span className="text-muted-2 font-sans text-[12px] font-medium">
              {show.episodeCount} total
            </span>
          </div>
          {show.episodes.length === 0 ? (
            <EpisodesEmpty href={newEpisodeHref} />
          ) : (
            <>
              <div>
                {show.episodes.map((e, i) => {
                  const row = (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="text-ink truncate text-[13px] font-medium">{e.title}</div>
                        <div className="text-muted-2 mt-[2px] text-[11.5px]">
                          {e.date} · {e.outputs}
                        </div>
                      </div>
                      <StatusPill status={e.status} />
                    </>
                  );
                  // Live-mode rows carry `id`; sample-mode fixtures don't, so
                  // those fall back to a non-link summary instead of dead URLs.
                  return e.id ? (
                    <Link
                      key={e.id}
                      href={`/episodes/${e.id}`}
                      className="hover:bg-canvas flex items-center gap-3 border-t border-[#F0F3F8] px-1 py-[13px] transition-colors"
                    >
                      {row}
                    </Link>
                  ) : (
                    <div
                      key={i}
                      className="flex items-center gap-3 border-t border-[#F0F3F8] px-1 py-[13px]"
                    >
                      {row}
                    </div>
                  );
                })}
              </div>
              {hasMoreEpisodes && (
                <Link
                  href={allEpisodesHref}
                  className="text-accent block border-t border-[#F0F3F8] px-1 py-[12px] font-sans text-[12.5px] font-semibold hover:underline"
                >
                  View all {show.episodeCount} episodes →
                </Link>
              )}
            </>
          )}
        </section>
      </div>
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

function VoicePlatformEmpty({ showKey }: { showKey: string }) {
  return (
    <div className="border-border bg-canvas rounded-2xl border border-dashed px-4 py-6 text-center">
      <p className="text-muted text-[12.5px] leading-[1.5]">
        No voice samples yet. Approve outputs in an episode to start training each platform.
      </p>
      <Link
        href={`/episodes/new?showId=${encodeURIComponent(showKey)}`}
        className="text-accent mt-3 inline-flex font-sans text-[12.5px] font-semibold hover:underline"
      >
        Add the first episode →
      </Link>
    </div>
  );
}

function EpisodesEmpty({ href }: { href: string }) {
  return (
    <div className="border-t border-[#F0F3F8] px-1 py-7 text-center">
      <p className="text-muted text-[12.5px]">No episodes yet for this show.</p>
      <Link
        href={href}
        className="text-accent mt-2 inline-flex font-sans text-[12.5px] font-semibold hover:underline"
      >
        Create the first episode →
      </Link>
    </div>
  );
}

/**
 * Compact display for an RSS feed URL — strip the protocol so the visible
 * text leads with the hostname (e.g. `feeds.simplecast.com/abc123`). Falls
 * back to the raw URL when parsing fails.
 */
function prettyHost(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return `${u.host}${path}`;
  } catch {
    return url;
  }
}
