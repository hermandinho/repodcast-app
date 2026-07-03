import { notFound } from "next/navigation";
import type { Platform } from "@prisma/client";
import { OutputsView } from "@/components/episodes/outputs-view";
import { getEpisodeForUI, isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { getBufferIntegrationForAgency } from "@/server/db/integrations";

export default async function EpisodeOutputsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await resolveTenantContext();
  const [result, buffer] = await Promise.all([
    getEpisodeForUI(tenant, id),
    isLiveDb() ? getBufferIntegrationForAgency(tenant).catch(() => null) : Promise.resolve(null),
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
      streamUrl={streamUrl}
      readOnly={readOnly}
      bufferConnected={buffer !== null}
      bufferConnectedPlatforms={bufferConnectedPlatforms}
    />
  );
}
