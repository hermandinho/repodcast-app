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

  // Read-only impersonation → server rejects all writes with ForbiddenError.
  // Threading the flag to the UI so buttons disable up front instead of
  // showing an optimistic "approved" that the API silently rolls back.
  const readOnly = tenant.impersonation?.mode === "read";

  return (
    <OutputsView
      client={result.show}
      episode={result.episode}
      viewerRole={tenant.role}
      streamUrl={streamUrl}
      readOnly={readOnly}
    />
  );
}
