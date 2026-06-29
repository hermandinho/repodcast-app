import { notFound } from "next/navigation";
import { OutputsView } from "@/components/episodes/outputs-view";
import { getEpisodeForUI, isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";

export default async function EpisodeOutputsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await resolveTenantContext();
  const result = await getEpisodeForUI(tenant, id);
  if (!result) notFound();

  // SSE is live-mode only — sample-data mode has no DB to poll.
  const streamUrl = isLiveDb() ? `/api/episodes/${id}/stream` : null;

  return (
    <OutputsView
      client={result.show}
      episode={result.episode}
      viewerRole={tenant.role}
      streamUrl={streamUrl}
    />
  );
}
