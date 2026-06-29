import Link from "next/link";
import { EpisodeStatus } from "@prisma/client";
import { EpisodeFilters } from "@/components/episodes/episode-filters";
import { EpisodeListSelection } from "@/components/episodes/episode-list-selection";
import { listEpisodeFilterOptionsForUI, listEpisodesForUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";

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

function parseString(raw: string | string[] | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Accepts `YYYY-MM-DD` from the native date inputs. Anything that doesn't
 * parse cleanly is silently dropped — bad URL params shouldn't crash the
 * page, and the picker resets to empty.
 */
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
  const from = parseDate(params.from);
  const to = parseDate(params.to);

  const tenant = await resolveTenantContext();
  const [options, { items, total }] = await Promise.all([
    listEpisodeFilterOptionsForUI(tenant),
    listEpisodesForUI(tenant, {
      search,
      showId,
      status,
      from,
      to,
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isFiltered = Boolean(search || showId || status || from || to);

  // Preserve current filter params on prev/next links — only `page` changes.
  const linkFor = (nextPage: number) => {
    const qp = new URLSearchParams();
    if (search) qp.set("q", search);
    if (showId) qp.set("show", showId);
    if (status) qp.set("status", status);
    // Echo the original URL strings back so the picker keeps its display value.
    if (typeof params.from === "string") qp.set("from", params.from);
    if (typeof params.to === "string") qp.set("to", params.to);
    if (nextPage > 1) qp.set("page", String(nextPage));
    const qs = qp.toString();
    return qs ? `/episodes?${qs}` : "/episodes";
  };

  const startN = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endN = Math.min(total, page * PAGE_SIZE);

  return (
    <div className="px-[30px] pt-[28px] pb-[60px]">
      <div className="mb-[22px] flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-ink text-[25px] font-semibold tracking-[-0.5px]">
            Episodes
          </h1>
          <p className="text-muted mt-[6px] text-[14px]">
            {total === 0
              ? isFiltered
                ? "No episodes match these filters"
                : "No episodes yet"
              : `${total} episode${total === 1 ? "" : "s"} · showing ${startN}–${endN}`}
          </p>
        </div>
        <Link
          href="/episodes/new"
          className="bg-accent shadow-card rounded-md px-[14px] py-[9px] font-sans text-[13px] font-semibold text-white transition-[filter] hover:brightness-105"
        >
          + New episode
        </Link>
      </div>

      <EpisodeFilters options={options} />

      {items.length === 0 ? (
        isFiltered ? (
          <EmptyFiltered />
        ) : (
          <EmptyNoEpisodes />
        )
      ) : (
        <>
          <EpisodeListSelection items={items} viewerRole={tenant.role} />

          {totalPages > 1 && (
            <nav
              className="text-muted mt-5 flex items-center justify-between gap-3 text-[12.5px]"
              aria-label="Episodes pagination"
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

function EmptyNoEpisodes() {
  return (
    <div className="border-border bg-canvas rounded-3xl border border-dashed px-6 py-12 text-center">
      <div className="bg-accent-soft text-accent mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="3" y="4" width="18" height="16" rx="2.5" />
          <path d="M12 9v6M9 12h6" />
        </svg>
      </div>
      <h2 className="font-display text-ink text-[18px] font-semibold">No episodes yet</h2>
      <p className="text-muted mx-auto mt-2 max-w-[460px] text-[13px]">
        Drop in a transcript and Repodcast will generate every platform&apos;s output in your
        client&apos;s voice.
      </p>
      <Link
        href="/episodes/new"
        className="bg-accent shadow-card mt-5 inline-flex rounded-md px-[14px] py-[9px] font-sans text-[13px] font-semibold text-white transition-[filter] hover:brightness-105"
      >
        Create your first episode
      </Link>
    </div>
  );
}

function EmptyFiltered() {
  return (
    <div className="border-border bg-canvas rounded-3xl border border-dashed px-6 py-10 text-center">
      <h2 className="font-display text-ink text-[16px] font-semibold">No matches</h2>
      <p className="text-muted mx-auto mt-2 max-w-[420px] text-[13px]">
        Try a different title, show, or status — or clear the filters.
      </p>
      <Link
        href="/episodes"
        className="border-border text-muted hover:border-accent-border hover:text-accent mt-4 inline-flex rounded-md border bg-white px-3 py-2 font-sans text-[12.5px] font-medium"
      >
        Clear filters
      </Link>
    </div>
  );
}
