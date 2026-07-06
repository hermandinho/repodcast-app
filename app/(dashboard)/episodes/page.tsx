import Link from "next/link";
import { EpisodeStatus } from "@prisma/client";
import { EpisodeFilters } from "@/components/episodes/episode-filters";
import { EpisodeListSelection } from "@/components/episodes/episode-list-selection";
import {
  episodeBucketTotalsForUI,
  listEpisodeFilterOptionsForUI,
  listEpisodesForUI,
} from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import type { EpisodeBucketFilter } from "@/server/db/episodes";

const PAGE_SIZE = 25;

function parsePage(raw: string | string[] | undefined): number {
  if (typeof raw !== "string") return 1;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseStatus(raw: string | string[] | undefined): EpisodeStatus | undefined {
  if (typeof raw !== "string") return undefined;
  return raw in EpisodeStatus ? (raw as EpisodeStatus) : undefined;
}

function parseBucket(raw: string | string[] | undefined): EpisodeBucketFilter | undefined {
  if (typeof raw !== "string") return undefined;
  return raw === "review" || raw === "drafts" || raw === "done" ? raw : undefined;
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

export default async function EpisodesListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = parsePage(params.page);
  const search = parseString(params.q);
  const showId = parseString(params.show);
  const status = parseStatus(params.status);
  const bucket = parseBucket(params.bucket);
  const from = parseDate(params.from);
  const to = parseDate(params.to);

  const tenant = await resolveTenantContext();
  const [options, bucketTotals, { items, total }] = await Promise.all([
    listEpisodeFilterOptionsForUI(tenant),
    episodeBucketTotalsForUI(tenant),
    listEpisodesForUI(tenant, {
      search,
      showId,
      status,
      bucket,
      from,
      to,
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isFiltered = Boolean(search || showId || status || bucket || from || to);
  const hasAnyEpisodes = bucketTotals.all > 0;

  const linkFor = (nextPage: number) => {
    const qp = new URLSearchParams();
    if (search) qp.set("q", search);
    if (showId) qp.set("show", showId);
    if (status) qp.set("status", status);
    if (bucket) qp.set("bucket", bucket);
    if (typeof params.from === "string") qp.set("from", params.from);
    if (typeof params.to === "string") qp.set("to", params.to);
    if (nextPage > 1) qp.set("page", String(nextPage));
    const qs = qp.toString();
    return qs ? `/episodes?${qs}` : "/episodes";
  };

  const startN = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endN = Math.min(total, page * PAGE_SIZE);

  // Subtitle: agency-wide episode count + review-attention nudge. Reads
  // the same bucket totals as the toolbar so numbers agree at a glance.
  const subtitle = hasAnyEpisodes
    ? `${bucketTotals.all} episode${bucketTotals.all === 1 ? "" : "s"} across all clients${
        bucketTotals.outputsWaitingReview > 0
          ? ` · ${bucketTotals.outputsWaitingReview} output${
              bucketTotals.outputsWaitingReview === 1 ? "" : "s"
            } waiting for review`
          : ""
      }`
    : "No episodes yet";

  return (
    <div className="px-4 pt-5 pb-14 sm:px-6 sm:pt-6 md:px-[32px] md:pt-[28px] md:pb-[60px]">
      {/* Header — title, subtitle, dual CTAs. `Review all waiting →` is
          the primary attention affordance when there's review work; the
          `+ New episode` outlined pair sits beside it as the always-on
          creation entry point. When there's no waiting work, `+ New
          episode` is the only CTA rendered. */}
      <div className="mb-[18px] flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-ink text-[24px] font-extrabold tracking-[-0.02em]">
            Episodes
          </h1>
          <p className="text-muted-2 mt-[4px] text-[13px]">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-[10px]">
          <Link
            href="/episodes/new"
            className={
              bucketTotals.outputsWaitingReview > 0
                ? "border-border text-muted hover:border-accent-border hover:text-accent shadow-card rounded-lg border bg-white px-[16px] py-[9px] font-sans text-[13px] font-semibold no-underline transition-colors"
                : "bg-ink shadow-card rounded-lg px-[18px] py-[9px] font-sans text-[13px] font-semibold text-white no-underline transition-[filter] hover:brightness-110"
            }
          >
            + New episode
          </Link>
          {bucketTotals.outputsWaitingReview > 0 && (
            <Link
              href="/episodes?bucket=review"
              className="bg-ink shadow-card rounded-lg px-[18px] py-[9px] font-sans text-[13px] font-semibold text-white no-underline transition-[filter] hover:brightness-110"
            >
              Review all waiting →
            </Link>
          )}
        </div>
      </div>

      <EpisodeFilters
        options={options}
        totalAll={bucketTotals.all}
        totalDraft={bucketTotals.draft}
        totalReview={bucketTotals.review}
      />

      {items.length === 0 ? (
        isFiltered ? (
          <EmptyFiltered
            searchTerm={search}
            activeChips={buildFilterChips({
              search,
              showId,
              status,
              bucket,
              from,
              to,
              options,
            })}
          />
        ) : (
          <EmptyNoEpisodes />
        )
      ) : (
        <>
          <EpisodeListSelection items={items} viewerRole={tenant.role} />

          <div className="text-muted-2 mt-[18px] flex flex-wrap items-center justify-between gap-3 text-[12.5px]">
            <span>
              Showing {startN === 0 ? 0 : `${startN}–${endN}`} of {total} episode
              {total === 1 ? "" : "s"}
            </span>
            {totalPages > 1 && (
              <nav className="text-muted flex items-center gap-3" aria-label="Episodes pagination">
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
          </div>
        </>
      )}
    </div>
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

/**
 * First-run state — no episodes exist for the agency yet. Centered card
 * with an equaliser-motif icon and a single primary CTA into the new-
 * episode wizard (which also handles RSS/YouTube/upload internally, so
 * we don't fork the intent into two buttons that lead to the same flow).
 */
function EmptyNoEpisodes() {
  return (
    <div className="border-border bg-surface rounded-2xl border px-8 py-[52px] text-center">
      <div className="border-accent-border bg-accent-soft mx-auto flex h-[64px] w-[64px] items-center justify-center rounded-[18px] border">
        <span aria-hidden className="flex items-center gap-[3px]">
          <span className="bg-accent h-[14px] w-[4px] rounded-[2px]" />
          <span className="bg-accent h-[24px] w-[4px] rounded-[2px]" />
          <span className="bg-accent/60 h-[10px] w-[4px] rounded-[2px]" />
          <span className="bg-accent/60 h-[18px] w-[4px] rounded-[2px]" />
        </span>
      </div>
      <h2 className="font-display text-ink mt-[18px] text-[18px] font-extrabold tracking-[-0.01em]">
        No episodes yet
      </h2>
      <p className="text-muted-2 mx-auto mt-[6px] max-w-[380px] text-[13px] leading-[1.5]">
        Upload your first recording or paste an RSS feed — Repodcast transcribes it and drafts
        outputs for every platform in your client&apos;s voice.
      </p>
      <div className="mt-[20px] flex flex-wrap justify-center gap-[10px]">
        <Link
          href="/episodes/new"
          className="bg-ink rounded-lg px-[18px] py-[10px] font-sans text-[13px] font-semibold text-white no-underline transition-[filter] hover:brightness-110"
        >
          + New episode
        </Link>
      </div>
      <p className="text-muted-2 mt-[16px] text-[12px]">
        Supports MP3, WAV, M4A, and video files up to 4 hours.
      </p>
    </div>
  );
}

type FilterChip = { label: string; clearHref: string };

/**
 * Compute the active filter chips shown in the "no results" state.
 * Each chip removes its own key from the URL when clicked, so the user
 * can peel filters back one at a time to widen the query.
 */
function buildFilterChips(input: {
  search?: string;
  showId?: string;
  status?: EpisodeStatus;
  bucket?: EpisodeBucketFilter;
  from?: Date;
  to?: Date;
  options: { shows: { id: string; name: string }[] };
}): FilterChip[] {
  const { search, showId, status, bucket, from, to, options } = input;
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (showId) params.set("show", showId);
  if (status) params.set("status", status);
  if (bucket) params.set("bucket", bucket);
  if (from) params.set("from", from.toISOString().slice(0, 10));
  if (to) params.set("to", to.toISOString().slice(0, 10));

  const chipHref = (dropKey: string) => {
    const next = new URLSearchParams(params.toString());
    next.delete(dropKey);
    const qs = next.toString();
    return qs ? `/episodes?${qs}` : "/episodes";
  };

  const BUCKET_LABEL: Record<EpisodeBucketFilter, string> = {
    review: "Needs review",
    drafts: "Draft",
    done: "Done",
  };
  const chips: FilterChip[] = [];
  if (bucket)
    chips.push({
      label: BUCKET_LABEL[bucket],
      clearHref: chipHref("bucket"),
    });
  if (status)
    chips.push({
      label: status === "READY" ? "Needs review" : status.charAt(0) + status.slice(1).toLowerCase(),
      clearHref: chipHref("status"),
    });
  if (showId) {
    const showName = options.shows.find((s) => s.id === showId)?.name ?? "Show";
    chips.push({ label: showName, clearHref: chipHref("show") });
  }
  if (from || to) {
    const fmt = (d: Date) =>
      new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
    const label =
      from && to ? `${fmt(from)} – ${fmt(to)}` : from ? `From ${fmt(from)}` : `To ${fmt(to!)}`;
    // Clearing the date range should drop both bounds together — a
    // single "date" chip on the UI, two URL keys under the hood.
    const next = new URLSearchParams(params.toString());
    next.delete("from");
    next.delete("to");
    const qs = next.toString();
    chips.push({ label, clearHref: qs ? `/episodes?${qs}` : "/episodes" });
  }
  return chips;
}

/**
 * No-results state — the current query returned zero rows but the
 * agency does have episodes. Show the search icon, the query in the
 * heading (when present), active filter chips the user can peel back
 * one at a time, and a `Clear all` reset.
 */
function EmptyFiltered({
  searchTerm,
  activeChips,
}: {
  searchTerm?: string;
  activeChips: FilterChip[];
}) {
  return (
    <div className="border-border bg-surface rounded-2xl border px-8 py-[40px] text-center">
      <div className="border-border bg-canvas mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-[14px] border">
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="var(--color-muted-2)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="9" cy="9" r="5" />
          <path d="m13 13 4 4" />
        </svg>
      </div>
      <h2 className="font-display text-ink mt-[14px] text-[15.5px] font-bold">
        {searchTerm ? `No episodes match "${searchTerm}"` : "No episodes match these filters"}
      </h2>
      <p className="text-muted-2 mt-[5px] text-[12.5px]">
        Try a different search, or clear the active filters.
      </p>
      {activeChips.length > 0 && (
        <div className="mt-[14px] flex flex-wrap items-center justify-center gap-[8px]">
          {activeChips.map((chip) => (
            <Link
              key={chip.label}
              href={chip.clearHref}
              className="border-accent-border bg-accent-soft text-ink inline-flex items-center gap-[6px] rounded-full border px-[11px] py-[5px] font-sans text-[12px] font-semibold no-underline"
            >
              {chip.label}
              <span className="text-muted-2" aria-hidden>
                ✕
              </span>
            </Link>
          ))}
          <Link
            href="/episodes"
            className="text-accent ml-[4px] font-sans text-[12.5px] font-semibold no-underline hover:brightness-95"
          >
            Clear all
          </Link>
        </div>
      )}
    </div>
  );
}
