import { EpisodeWizard } from "@/components/episodes/episode-wizard";
import { loadCapacityForUI, type PlanCapacityForUI } from "@/server/billing/limits";
import { isLiveDb, listClientsForUI, listShowsForUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";

export default async function NewEpisodePage({
  searchParams,
}: {
  searchParams: Promise<{ showId?: string; clientId?: string }>;
}) {
  const tenant = await resolveTenantContext();
  const [shows, clientsRaw, sp, capacity] = await Promise.all([
    listShowsForUI(tenant),
    listClientsForUI(tenant),
    searchParams,
    // Sample-data mode (no DATABASE_URL) skips the capacity probe — the
    // banner takes null and renders nothing, so the design preview stays
    // free of pretend-cap warnings.
    isLiveDb()
      ? loadCapacityForUI(tenant.agencyId, "episodes")
      : Promise.resolve<PlanCapacityForUI | null>(null),
  ]);

  // Map clients down to the wizard's `{ id, name }` filter shape. The
  // wizard does its own client→shows narrowing client-side.
  const clients = clientsRaw.map((c) => ({ id: c.key, name: c.name }));

  // URL deep-links: `?showId=…` from a show's "Add episode" button preselects
  // the show; `?clientId=…` from a client surface pre-narrows the filter.
  const initialShowKey = shows.some((s) => s.key === sp.showId) ? sp.showId : undefined;
  const initialClientId = clients.some((c) => c.id === sp.clientId) ? sp.clientId : undefined;

  return (
    <EpisodeWizard
      shows={shows}
      clients={clients}
      initialShowKey={initialShowKey}
      initialClientId={initialClientId}
      episodeCapacity={capacity}
    />
  );
}
