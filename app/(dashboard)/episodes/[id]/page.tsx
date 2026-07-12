import { notFound } from "next/navigation";
import type { Platform } from "@prisma/client";
import { OutputsView } from "@/components/episodes/outputs-view";
import { getEpisodeForUI, isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";
import { getBufferIntegrationForAgency } from "@/server/db/integrations";

export default async function EpisodeOutputsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await resolveTenantContext();
  const [result, buffer, artwork] = await Promise.all([
    getEpisodeForUI(tenant, id),
    isLiveDb() ? getBufferIntegrationForAgency(tenant).catch(() => null) : Promise.resolve(null),
    isLiveDb() ? loadArtwork(tenant.agencyId, id) : Promise.resolve(null),
  ]);
  if (!result) notFound();

  // SSE is live-mode only — sample-data mode has no DB to poll.
  const streamUrl = isLiveDb() ? `/api/episodes/${id}/stream` : null;

  // Read-only impersonation → server rejects all writes with ForbiddenError.
  const readOnly = tenant.impersonation?.mode === "read";

  // Which platforms actually have a Buffer channel behind them. The
  // "Force Buffer" radio in the schedule popover disables per-platform
  // when the account has Buffer connected but not that specific channel.
  const bufferConnectedPlatforms: Platform[] = buffer
    ? (Object.keys(buffer.meta.profiles) as Platform[]).filter((p) => buffer.meta.profiles[p])
    : [];

  return (
    <OutputsView
      client={result.show}
      episode={result.episode}
      viewerRole={tenant.role}
      clientValidationMode={result.clientValidationMode}
      streamUrl={streamUrl}
      readOnly={readOnly}
      bufferConnected={buffer !== null}
      bufferConnectedPlatforms={bufferConnectedPlatforms}
      artwork={artwork}
    />
  );
}

/**
 * Fetch the four artwork fields off the Episode row. Kept local to
 * this route because the shape (three nullable URLs + a JSON concept)
 * isn't reused elsewhere yet — if artwork surfaces on the shows page
 * or the client portal later, promote to `server/db/episodes.ts`.
 */
async function loadArtwork(
  agencyId: string,
  episodeId: string,
): Promise<{
  heroImageUrl: string | null;
  squareCoverUrl: string | null;
  verticalCoverUrl: string | null;
  concept: Record<string, unknown> | null;
} | null> {
  const row = await prisma.episode.findFirst({
    where: { id: episodeId, show: { client: { agencyId } } },
    select: {
      heroImageUrl: true,
      squareCoverUrl: true,
      verticalCoverUrl: true,
      artworkConcept: true,
    },
  });
  if (!row) return null;
  return {
    heroImageUrl: row.heroImageUrl,
    squareCoverUrl: row.squareCoverUrl,
    verticalCoverUrl: row.verticalCoverUrl,
    concept:
      row.artworkConcept &&
      typeof row.artworkConcept === "object" &&
      !Array.isArray(row.artworkConcept)
        ? (row.artworkConcept as Record<string, unknown>)
        : null,
  };
}
