import Link from "next/link";
import { notFound } from "next/navigation";
import { PlatformBadge } from "@/components/ui/platform-badge";
import { ShowDetailActions } from "@/components/shows/show-detail-actions";
import { getClientForUI, getShowForUI, getShowEditInitialForUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { platforms, type PlatformKey } from "@/lib/sample-data/platforms";
import { voiceLabel } from "@/lib/sample-data/voice-strength";
import { statusMeta } from "@/lib/sample-data/episode-status";

/**
 * Show detail page — revamp per ref/UI/Revamp/Show.html option 1a.
 *
 * Layout:
 *   1. Breadcrumb.
 *   2. Identity header card — avatar, title with inline voice-status
 *      pill, meta row (host · episodes · updated · RSS), action stack.
 *   3. Attention strip (dark navy) — only when there are outputs
 *      pending review. Links straight to the episodes queue.
 *   4. Two-column grid:
 *      - Voice strength by platform card (per-platform amber ladder,
 *        "N approved · M more to Developing" caption) + next-best-
 *        action hint pointing at the platform closest to leveling up.
 *      - Episodes card with filter chips + per-row Review CTA + footer
 *        link to `/episodes?show=…` when there are more than we render.
 *
 * Every ref accent-blue is intentionally mapped to `var(--color-accent)`
 * so the workspace brand color drives the page; the ref's blue is only
 * mockup color and does not follow through to production.
 */

// Milestone thresholds — mirror `lib/sample-data/voice-strength.ts`.
const DEVELOPING_MIN = 6;
const STRONG_MIN = 16;

const WEAK_TEXT = "#A06D12";
const WEAK_BG_SOFT = "#F9F1DE";
const AMBER = "#D9A13C";
const STRONG_TEXT = "#1E7A47";
const STRONG_BG_SOFT = "#E4F3EC";
const ACCENT_SOFT = "#EEF2FB";

export default async function ShowDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const tenant = await resolveTenantContext();
  const [show, editInitial] = await Promise.all([
    getShowForUI(tenant, key),
    getShowEditInitialForUI(tenant, key),
  ]);
  if (!show) notFound();

  // Parent client for the breadcrumb. Optional — a missing lookup
  // (cross-tenant, deleted, sample-mode quirk) degrades to a plain
  // "Shows / {show.name}" trail.
  const parentClient = await getClientForUI(tenant, show.clientKey);

  const level = voiceLabel(show.samples);
  const untilStrong = Math.max(0, STRONG_MIN - show.samples);
  const untilDeveloping = Math.max(0, DEVELOPING_MIN - show.samples);
  const nextMilestoneLabel =
    show.samples < DEVELOPING_MIN
      ? `${untilDeveloping} approvals to Developing`
      : untilStrong > 0
        ? `${untilStrong} approvals to Established`
        : "Voice is Established";

  const totalPending = show.episodes.reduce((n, e) => n + e.pendingReviewCount, 0);
  const episodesWithPending = show.episodes.filter((e) => e.pendingReviewCount > 0).length;

  const description = editInitial?.description?.trim() ?? "";
  const hasMoreEpisodes = show.episodeCount > show.episodes.length;
  const newEpisodeHref = `/episodes/new?showId=${encodeURIComponent(show.key)}`;
  const allEpisodesHref = `/episodes?show=${encodeURIComponent(show.key)}`;

  // Next-best-action hint: whichever platform is closest to Developing
  // (≥1 sample, fewest samples). Empty when we haven't started at all.
  const nextPlatform = pickNextPlatformHint(show.platformSamples);

  return (
    <div className="bg-[#F6F8FC] px-8 pt-6 pb-14">
      <div className="mx-auto max-w-[1140px]">
        {/* Breadcrumb */}
        <nav
          aria-label="Breadcrumb"
          className="flex flex-wrap items-center gap-[8px] text-[12.5px] text-[#8A97AD]"
        >
          <Link href="/clients" className="hover:text-[#0A1E3C]">
            Clients
          </Link>
          <span className="text-[#C8D0DD]">/</span>
          {parentClient ? (
            <Link href={`/clients/${parentClient.key}`} className="hover:text-[#0A1E3C]">
              {parentClient.name}
            </Link>
          ) : (
            <span>—</span>
          )}
          <span className="text-[#C8D0DD]">/</span>
          <Link href="/shows" className="hover:text-[#0A1E3C]">
            Shows
          </Link>
          <span className="text-[#C8D0DD]">/</span>
          <span className="truncate font-semibold text-[#0A1E3C]">{show.name}</span>
        </nav>

        {/* Identity header card */}
        <div className="mt-4 rounded-[14px] border border-[#E4E9F1] bg-white px-7 py-6">
          <div className="flex flex-wrap items-start gap-5">
            {show.artworkUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={show.artworkUrl}
                alt=""
                className="h-[72px] w-[72px] flex-none rounded-[16px] object-cover"
                style={{ background: "#EEF1F6" }}
              />
            ) : (
              <div
                className="font-display flex h-[72px] w-[72px] flex-none items-center justify-center rounded-[16px] text-[22px] font-extrabold text-white"
                style={{ background: show.avatarBg }}
              >
                {show.initial}
              </div>
            )}

            <div className="min-w-[240px] flex-1">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-[#0A1E3C]">
                  {show.name}
                </h1>
                <VoiceStatusPill level={level} nextMilestoneLabel={nextMilestoneLabel} />
              </div>
              <div className="mt-[6px] flex flex-wrap items-center gap-4 text-[13px] text-[#8A97AD]">
                <span>
                  Hosted by <span className="font-semibold text-[#41506B]">{show.host}</span>
                </span>
                <MetaDot />
                <span>
                  {show.episodeCount} episode{show.episodeCount === 1 ? "" : "s"}
                </span>
                <MetaDot />
                <span>Updated {show.lastActivity}</span>
                {show.rssUrl && (
                  <>
                    <MetaDot />
                    <a
                      href={show.rssUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-accent max-w-[280px] truncate font-mono text-[11px] hover:underline"
                      title={show.rssUrl}
                    >
                      {prettyHost(show.rssUrl)} ↗
                    </a>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-none flex-wrap items-center gap-2">
              <Link
                href={`/voice/${encodeURIComponent(show.key)}`}
                className="rounded-[8px] border border-[#E4E9F1] bg-white px-[14px] py-[8px] text-[13px] font-semibold text-[#41506B] no-underline hover:border-[#B7C3D6]"
              >
                ∿ Voice profile
              </Link>
              {editInitial && <ShowDetailActions showId={show.key} initial={editInitial} />}
              <Link
                href={newEpisodeHref}
                className="bg-accent inline-flex items-center gap-2 rounded-[8px] px-4 py-[9px] text-[13.5px] font-semibold text-white no-underline transition-[filter] hover:brightness-95"
              >
                + Add episode
              </Link>
            </div>
          </div>
        </div>

        {/* Attention strip — only when there's something to review. */}
        {totalPending > 0 && (
          <Link
            href={`/episodes?show=${encodeURIComponent(show.key)}`}
            className="mt-[14px] flex items-center gap-[18px] rounded-[12px] bg-[#0A1E3C] px-6 py-[15px] text-white no-underline hover:brightness-110"
          >
            <span
              className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] text-[15px]"
              style={{ background: "rgba(224,163,62,.18)", color: "#E0A33E" }}
            >
              ◔
            </span>
            <div className="flex-1">
              <div className="text-[14px] font-bold">
                {totalPending} output{totalPending === 1 ? "" : "s"} across {episodesWithPending}{" "}
                episode{episodesWithPending === 1 ? "" : "s"}{" "}
                {episodesWithPending === 1 ? "is" : "are"} ready for review
              </div>
              <div className="mt-[2px] text-[12.5px] text-[#A9B8D4]">
                Every approval strengthens this show&apos;s voice.
              </div>
            </div>
            <span className="bg-accent flex-none rounded-[8px] px-[18px] py-[9px] text-[13px] font-semibold text-white">
              Review outputs →
            </span>
          </Link>
        )}

        {/* About block — only when the show has a description. */}
        {description && (
          <div className="mt-[14px] rounded-[12px] border border-[#E4E9F1] bg-white px-6 py-5">
            <div className="font-mono text-[10.5px] tracking-[0.12em] text-[#8A97AD] uppercase">
              About this show
            </div>
            <p className="mt-2 text-[13.5px] leading-[1.6] whitespace-pre-wrap text-[#0A1E3C]">
              {description}
            </p>
          </div>
        )}

        {/* Main grid: voice strength (.95fr) + episodes (1.05fr) */}
        <div className="mt-[14px] grid items-start gap-[14px] lg:grid-cols-[0.95fr_1.05fr]">
          {/* Voice strength by platform */}
          <section className="rounded-[12px] border border-[#E4E9F1] bg-white px-6 py-5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[15px] font-bold text-[#0A1E3C]">
                Voice strength by platform
              </span>
              <span
                className="rounded-full px-[9px] py-[3px] font-mono text-[9.5px] tracking-[0.08em] uppercase"
                style={{
                  background: bgFor(level),
                  color: textFor(level),
                }}
              >
                {level}
              </span>
            </div>
            <p className="mt-1 text-[12.5px] text-[#8A97AD]">
              Each platform trains on its own approved outputs. {DEVELOPING_MIN} approvals moves a
              platform to Developing.
            </p>

            {show.samples === 0 ? (
              <VoicePlatformEmpty showKey={show.key} />
            ) : (
              <div className="mt-[14px] flex flex-col">
                {platforms.map((p, i) => {
                  const n = show.platformSamples[p.key] ?? 0;
                  const lvl = voiceLabel(n);
                  const needed = Math.max(0, DEVELOPING_MIN - n);
                  const caption =
                    lvl === "Weak"
                      ? `${n} approved${needed > 0 ? ` · ${needed} more to Developing` : ""}`
                      : lvl === "Developing"
                        ? `${n} approved · ${Math.max(0, STRONG_MIN - n)} more to Established`
                        : `${n} approved · Established`;
                  const isLast = i === platforms.length - 1;
                  return (
                    <div
                      key={p.key}
                      className={`grid items-center gap-3 py-[10px] ${
                        !isLast ? "border-b border-[#F4F6FA]" : ""
                      }`}
                      style={{ gridTemplateColumns: "30px minmax(0, 1fr) 110px auto" }}
                    >
                      <div className="flex justify-center">
                        <PlatformBadge platform={p} size="sm" />
                      </div>
                      <div>
                        <div className="text-[13.5px] font-semibold text-[#0A1E3C]">{p.name}</div>
                        <div className="text-[11.5px] text-[#8A97AD]">{caption}</div>
                      </div>
                      <PlatformSegments samples={n} />
                      <span
                        className="rounded-full px-[9px] py-[3px] text-[11px] font-semibold"
                        style={{
                          background: bgFor(lvl),
                          color: textFor(lvl),
                        }}
                      >
                        {lvl}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Next-best-action hint. Only rendered when we can actually
                point at a platform closest to leveling up. */}
            {nextPlatform && (
              <div className="mt-[14px] flex items-center gap-2 rounded-[8px] bg-[#F6F8FC] px-[14px] py-[10px] text-[12.5px] text-[#41506B]">
                <span className="text-accent">ⓘ</span>
                Fastest path: review the waiting {nextPlatform.name} outputs first.
              </div>
            )}
          </section>

          {/* Episodes */}
          <section className="overflow-hidden rounded-[12px] border border-[#E4E9F1] bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EEF1F6] px-6 py-[18px]">
              <div className="flex items-baseline gap-[10px]">
                <span className="text-[15px] font-bold text-[#0A1E3C]">Episodes</span>
                <span className="text-[12.5px] text-[#8A97AD]">
                  {show.episodeCount} total · newest first
                </span>
              </div>
              <EpisodeFilters count={show.episodeCount} pending={totalPending} />
            </div>

            {show.episodes.length === 0 ? (
              <EpisodesEmpty href={newEpisodeHref} />
            ) : (
              <div className="flex flex-col">
                {show.episodes.map((e, i) => {
                  const isFirst = i === 0;
                  const isLast = i === show.episodes.length - 1;
                  const pending = e.pendingReviewCount > 0;
                  const processing = e.status === "generating" || e.status === "review";
                  const noOutputs = e.outputCount === 0 && !processing;
                  const meta = statusMeta(e.status);
                  const row = (
                    <div
                      className={`flex items-center gap-[14px] px-6 py-[14px] transition-colors ${
                        !isLast ? "border-b border-[#F4F6FA]" : ""
                      } ${isFirst ? "bg-[#FBFCFE]" : "hover:bg-[#FBFCFE]"}`}
                    >
                      <span
                        className={`font-display flex h-9 w-9 flex-none items-center justify-center rounded-[9px] text-[11px] font-extrabold text-white ${
                          e.status === "generating" || e.outputCount === 0 ? "opacity-70" : ""
                        }`}
                        style={{ background: show.avatarBg }}
                      >
                        {show.initial}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div
                          className={`truncate text-[13.5px] font-bold ${
                            e.status === "generating" ? "text-[#8A97AD]" : "text-[#0A1E3C]"
                          }`}
                        >
                          {e.title || "Untitled episode"}
                        </div>
                        <div className="mt-[2px] truncate text-[11.5px] text-[#8A97AD]">
                          {e.date}
                          {e.status === "generating"
                            ? " · transcribing…"
                            : e.outputCount > 0
                              ? ` · ${e.outputCount} outputs · ${e.outputCount - e.pendingReviewCount} reviewed`
                              : ""}
                        </div>
                      </div>

                      {pending ? (
                        <span className="flex-none rounded-full bg-[#F9F1DE] px-[10px] py-1 text-[11px] font-semibold text-[#B07818]">
                          {e.pendingReviewCount} to review
                        </span>
                      ) : e.status === "generating" ? (
                        <span className="flex-none rounded-full bg-[#F1F4F9] px-[10px] py-1 text-[11px] font-semibold text-[#41506B]">
                          Processing
                        </span>
                      ) : noOutputs ? (
                        <span className="flex-none rounded-full bg-[#F1F4F9] px-[10px] py-1 text-[11px] font-semibold text-[#41506B]">
                          No outputs
                        </span>
                      ) : (
                        <span
                          className="flex-none rounded-full px-[10px] py-1 text-[11px] font-semibold"
                          style={{ background: meta.bg, color: meta.color }}
                        >
                          {meta.label}
                        </span>
                      )}

                      {pending && isFirst ? (
                        <span className="bg-accent flex-none rounded-[7px] px-[13px] py-[7px] text-[12px] font-semibold text-white">
                          Review
                        </span>
                      ) : pending || (e.outputCount > 0 && !processing) ? (
                        <span className="flex-none rounded-[7px] border border-[#E4E9F1] bg-white px-[13px] py-[6px] text-[12px] font-semibold text-[#41506B]">
                          {pending ? "Review" : "Open"}
                        </span>
                      ) : (
                        <span className="flex-none rounded-[7px] border border-[#EEF1F6] bg-white px-[13px] py-[6px] text-[12px] font-semibold text-[#B0BACB]">
                          {e.status === "generating" ? "Review" : "Generate"}
                        </span>
                      )}
                    </div>
                  );
                  return e.id ? (
                    <Link key={e.id} href={`/episodes/${e.id}`} className="no-underline">
                      {row}
                    </Link>
                  ) : (
                    <div key={i}>{row}</div>
                  );
                })}
              </div>
            )}

            {hasMoreEpisodes && (
              <div className="border-t border-[#EEF1F6] px-6 py-[13px] text-center">
                <Link
                  href={allEpisodesHref}
                  className="text-accent text-[12.5px] font-semibold no-underline hover:brightness-90"
                >
                  View all {show.episodeCount} episodes →
                </Link>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Small display helpers
// ============================================================

function MetaDot() {
  return <span className="h-[3px] w-[3px] rounded-full bg-[#C8D0DD]" />;
}

function VoiceStatusPill({
  level,
  nextMilestoneLabel,
}: {
  level: "Weak" | "Developing" | "Strong";
  nextMilestoneLabel: string;
}) {
  return (
    <span
      className="rounded-full px-[10px] py-1 text-[11px] font-semibold"
      style={{
        background: bgFor(level),
        color: textFor(level),
      }}
    >
      Voice {level.toLowerCase()} · {nextMilestoneLabel}
    </span>
  );
}

/**
 * Three-segment strength ladder for a single platform: each segment fills
 * amber as the sample count crosses each `DEVELOPING_MIN / 3` step. Purely
 * decorative — the numeric caption underneath the platform name is the
 * authoritative signal.
 */
function PlatformSegments({ samples }: { samples: number }) {
  const step = DEVELOPING_MIN / 3;
  return (
    <div className="flex gap-[3px]">
      {[0, 1, 2].map((i) => {
        const filled = samples >= step * (i + 1);
        const partial = !filled && samples > step * i;
        return (
          <div
            key={i}
            className="h-[5px] flex-1 rounded-[3px]"
            style={{ background: filled || partial ? AMBER : ACCENT_SOFT }}
          />
        );
      })}
    </div>
  );
}

/**
 * Static filter chips — the counts derive from show state but the ref
 * doesn't wire the filters up; they're a visual affordance for now.
 */
function EpisodeFilters({ count, pending }: { count: number; pending: number }) {
  return (
    <div className="flex gap-[6px]">
      <span className="rounded-full bg-[#0A1E3C] px-[12px] py-[5px] text-[12px] font-semibold text-white">
        All {count}
      </span>
      {pending > 0 && (
        <span className="rounded-full border border-[#E4E9F1] px-[12px] py-[5px] text-[12px] font-medium text-[#41506B]">
          Needs review {pending}
        </span>
      )}
    </div>
  );
}

function VoicePlatformEmpty({ showKey }: { showKey: string }) {
  return (
    <div className="mt-[14px] rounded-[10px] border border-dashed border-[#E4E9F1] bg-[#FBFCFE] px-4 py-6 text-center">
      <p className="text-[12.5px] leading-[1.5] text-[#8A97AD]">
        No voice samples yet. Approve outputs in an episode to start training each platform.
      </p>
      <Link
        href={`/episodes/new?showId=${encodeURIComponent(showKey)}`}
        className="text-accent mt-3 inline-flex text-[12.5px] font-semibold no-underline hover:brightness-90"
      >
        Add the first episode →
      </Link>
    </div>
  );
}

function EpisodesEmpty({ href }: { href: string }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="text-[12.5px] text-[#8A97AD]">No episodes yet for this show.</p>
      <Link
        href={href}
        className="text-accent mt-2 inline-flex text-[12.5px] font-semibold no-underline hover:brightness-90"
      >
        Create the first episode →
      </Link>
    </div>
  );
}

function bgFor(level: "Weak" | "Developing" | "Strong"): string {
  return level === "Strong" ? STRONG_BG_SOFT : level === "Weak" ? WEAK_BG_SOFT : ACCENT_SOFT;
}
function textFor(level: "Weak" | "Developing" | "Strong"): string {
  return level === "Strong" ? STRONG_TEXT : level === "Weak" ? WEAK_TEXT : "var(--color-accent)";
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

/**
 * "Fastest path" hint. Points at whichever platform is closest to
 * leveling up: prefer a Weak platform with at least one approved sample
 * (visible progress), fall back to the platform with the most samples
 * that isn't already Established. Returns null when the show has no
 * approvals at all — the empty state owns that surface.
 */
function pickNextPlatformHint(
  perPlatform: Record<PlatformKey, number>,
): { name: string; samples: number } | null {
  const withSamples = platforms
    .map((p) => ({ name: p.name, samples: perPlatform[p.key] ?? 0 }))
    .filter((p) => p.samples > 0 && p.samples < STRONG_MIN);
  if (withSamples.length === 0) return null;
  withSamples.sort((a, b) => b.samples - a.samples);
  return withSamples[0]!;
}
