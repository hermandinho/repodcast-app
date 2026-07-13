import { notFound } from "next/navigation";
import { EpisodeHeader } from "@/components/episodes/episode-header";
import { isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";

/**
 * Q1 wk10 UI revamp — shared shell for every /episodes/[id]/* route.
 *
 * The layout owns the breadcrumb + title + tab bar; tabs render only
 * their own content. Layout persistence across tab switches is why
 * navigating between Outputs / Clips / Artwork / Audiograms is instant
 * (no full re-render, no header flicker).
 *
 * Data: we only fetch what the header needs (title + show name + client
 * label + short meta line). Each tab page fetches its own tab-specific
 * data. That's one extra query per view compared to a single-page
 * design, but the header data is tiny and Prisma resolves it in <5 ms.
 */
export default async function EpisodeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenant = await resolveTenantContext();
  const header = await loadHeader(tenant.agencyId, id);
  if (!header) notFound();

  // Full-bleed shell — no outer max-width, no side padding on mobile.
  // The header + each tab manage their own padding so the Outputs tab's
  // right-anchored sidebar can sit flush against the viewport edge while
  // single-column tabs stay comfortably readable via their own max-w.
  return (
    <div className="w-full">
      <EpisodeHeader
        episodeId={id}
        title={header.title}
        showKey={header.showKey}
        showName={header.showName}
        clientLabel={header.clientLabel}
        metaLine={header.metaLine}
      />
      {children}
    </div>
  );
}

async function loadHeader(
  agencyId: string,
  episodeId: string,
): Promise<{
  title: string;
  showKey: string | null;
  showName: string;
  clientLabel: string;
  metaLine: string;
} | null> {
  if (!isLiveDb()) {
    // Sample-data mode — synthetic header. The children still render
    // whatever their own sample-data path returns.
    return {
      title: "Sample episode",
      showKey: null,
      showName: "Sample show",
      clientLabel: "Sample client",
      metaLine: "Draft",
    };
  }

  const row = await prisma.episode.findFirst({
    where: { id: episodeId, show: { client: { agencyId } } },
    select: {
      title: true,
      recordedAt: true,
      durationSec: true,
      show: {
        select: {
          id: true,
          name: true,
          client: { select: { name: true } },
        },
      },
      outputs: {
        where: { supersededAt: null },
        select: { platform: true },
      },
    },
  });
  if (!row) return null;

  const platformCount = new Set(row.outputs.map((o) => o.platform)).size;
  const recorded = row.recordedAt ? row.recordedAt.toLocaleDateString() : null;
  const durationMin =
    row.durationSec != null && row.durationSec > 0
      ? `${Math.round(row.durationSec / 60)} min`
      : null;
  const metaParts = [
    platformCount > 0 ? `${platformCount} platform${platformCount === 1 ? "" : "s"}` : null,
    recorded,
    durationMin,
  ].filter(Boolean);

  return {
    title: row.title,
    showKey: row.show.id,
    showName: row.show.name,
    clientLabel: row.show.client.name,
    metaLine: metaParts.length > 0 ? metaParts.join(" · ") : "Draft",
  };
}
