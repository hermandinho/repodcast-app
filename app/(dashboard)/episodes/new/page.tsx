import { EpisodeWizard } from "@/components/episodes/episode-wizard";
import { loadCapacityForUI, type PlanCapacityForUI } from "@/server/billing/limits";
import { isLiveDb, listShowsForUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";

export default async function NewEpisodePage({
  searchParams,
}: {
  searchParams: Promise<{ showId?: string }>;
}) {
  const tenant = await resolveTenantContext();
  const [shows, sp, capacity] = await Promise.all([
    listShowsForUI(tenant),
    searchParams,
    // Sample-data mode (no DATABASE_URL) skips the capacity probe — the
    // banner takes null and renders nothing, so the design preview stays
    // free of pretend-cap warnings.
    isLiveDb()
      ? loadCapacityForUI(tenant.agencyId, "episodes")
      : Promise.resolve<PlanCapacityForUI | null>(null),
  ]);
  const initialShowKey = shows.some((s) => s.key === sp.showId) ? sp.showId : undefined;
  return (
    <EpisodeWizard clients={shows} initialClientKey={initialShowKey} episodeCapacity={capacity} />
  );
}
