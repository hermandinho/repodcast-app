import { notFound } from "next/navigation";
import type { Platform } from "@prisma/client";
import { OutputsView } from "@/components/episodes/outputs-view";
import { getEpisodeForUI, isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { getBufferIntegrationForAgency } from "@/server/db/integrations";

/**
 * Outputs tab. The breadcrumb + title + tab bar live on the shared
 * layout at `../layout.tsx`; this page renders only the tab's content
 * (KPI strip, clip moments, outputs grid).
 */
export default async function EpisodeOutputsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await resolveTenantContext();
  const [result, buffer] = await Promise.all([
    getEpisodeForUI(tenant, id),
    isLiveDb() ? getBufferIntegrationForAgency(tenant).catch(() => null) : Promise.resolve(null),
  ]);
  if (!result) notFound();

  const streamUrl = isLiveDb() ? `/api/episodes/${id}/stream` : null;
  const readOnly = tenant.impersonation?.mode === "read";

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
    />
  );
}
