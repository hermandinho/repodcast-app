"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { EditableTitle } from "@/components/episodes/editable-title";

/**
 * Q1 wk10 UI revamp — shared header + tab bar rendered from the episode
 * layout. Every /episodes/[id]/* route inherits this chrome, so
 * switching tabs is instant (Next.js layout persistence) and the tab
 * bar always reflects the currently-active view via
 * `useSelectedLayoutSegment()` — the segment name is null for the root
 * Outputs page and the folder name for sub-routes.
 */

type Tab = {
  segment: string | null;
  label: string;
  href: (id: string) => string;
};

const TABS: Tab[] = [
  { segment: null, label: "Outputs", href: (id) => `/episodes/${id}` },
  { segment: "clips", label: "Clips", href: (id) => `/episodes/${id}/clips` },
  { segment: "artwork", label: "Artwork", href: (id) => `/episodes/${id}/artwork` },
  {
    segment: "audiograms",
    label: "Audiograms",
    href: (id) => `/episodes/${id}/audiograms`,
  },
];

export function EpisodeHeader({
  episodeId,
  title,
  showKey,
  showName,
  clientLabel,
  metaLine,
}: {
  episodeId: string;
  title: string;
  /** For the breadcrumb link to /shows/[key]. Null when we're in sample mode
   *  or the show record isn't reachable. */
  showKey: string | null;
  showName: string;
  clientLabel: string;
  metaLine: string;
}) {
  const activeSegment = useSelectedLayoutSegment();

  return (
    <div className="border-border bg-canvas mb-4 w-full border-b px-4 pt-5 pb-0 sm:px-6 md:px-7">
      <nav aria-label="Breadcrumb" className="text-muted-2 text-[12.5px]">
        <Link href="/shows" className="hover:text-ink transition-colors">
          Shows
        </Link>
        <span className="mx-[7px] text-[#C3CBD8]">/</span>
        {showKey ? (
          <Link href={`/shows/${showKey}`} className="hover:text-ink transition-colors">
            {showName}
          </Link>
        ) : (
          <span>{showName}</span>
        )}
        <span className="mx-[7px] text-[#C3CBD8]">/</span>
        <span className="text-muted inline-block max-w-[360px] truncate align-bottom">{title}</span>
      </nav>

      <div className="mt-3 flex flex-col gap-1.5">
        <EditableTitle episodeId={episodeId} initial={title} />
        <div className="text-muted text-[13px]">
          {clientLabel} · {metaLine}
        </div>
      </div>

      <nav
        aria-label="Episode tabs"
        className="mt-5 mb-4 inline-flex flex-wrap items-center overflow-x-auto"
        style={{
          background: "#eef1f6",
          borderRadius: 9,
          padding: 3,
          gap: 4,
          width: "fit-content",
          maxWidth: "100%",
        }}
      >
        {TABS.map((tab) => {
          const isActive = tab.segment === activeSegment;
          return (
            <Link
              key={tab.label}
              href={tab.href(episodeId)}
              aria-current={isActive ? "page" : undefined}
              className="no-underline transition-colors"
              style={{
                fontSize: 13.5,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? "#0a1e3c" : "#41506b",
                background: isActive ? "#ffffff" : "transparent",
                padding: "7px 16px",
                borderRadius: 7,
                boxShadow: isActive ? "0 1px 3px rgba(10,30,60,0.10)" : "none",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
