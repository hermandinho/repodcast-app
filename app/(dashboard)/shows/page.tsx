import Link from "next/link";
import { NewShowButton } from "@/components/shows/new-show-button";
import { ShowsBrowser } from "@/components/shows/shows-browser";
import { loadCapacityForUI, type PlanCapacityForUI } from "@/server/billing/limits";
import { isLiveDb, listClientsForUI, listShowsForUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";

/**
 * All shows across the agency, grouped by their parent client. The list-page
 * "Add show" header button feeds the modal the full client list so the user
 * picks the parent at creation time; the per-client surface on `/clients/[key]`
 * locks the picker to that client instead.
 */
export default async function ShowsPage() {
  const tenant = await resolveTenantContext();
  const [shows, clients, capacity] = await Promise.all([
    listShowsForUI(tenant),
    listClientsForUI(tenant),
    isLiveDb()
      ? loadCapacityForUI(tenant.agencyId, "shows")
      : Promise.resolve<PlanCapacityForUI | null>(null),
  ]);
  const pickerClients = clients.map((c) => ({ id: c.key, name: c.name }));
  const browserClients = clients.map((c) => ({ key: c.key, name: c.name }));

  return (
    <div className="px-4 pt-5 pb-14 sm:px-6 sm:pt-6 md:px-[30px] md:pt-[28px] md:pb-[60px]">
      <div className="mb-[22px] flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-ink text-[25px] font-semibold tracking-[-0.5px]">
            Shows
          </h1>
          <p className="text-muted mt-[6px] text-[14px]">
            {shows.length} podcast{shows.length === 1 ? "" : "s"} across {clients.length} client
            {clients.length === 1 ? "" : "s"}
          </p>
        </div>
        <NewShowButton clients={pickerClients} capacity={capacity} />
      </div>

      {shows.length === 0 ? (
        <ShowsEmptyState
          pickerClients={pickerClients}
          hasClients={clients.length > 0}
          capacity={capacity}
        />
      ) : (
        <ShowsBrowser shows={shows} clients={browserClients} />
      )}
    </div>
  );
}

function ShowsEmptyState({
  pickerClients,
  hasClients,
  capacity,
}: {
  pickerClients: { id: string; name: string }[];
  hasClients: boolean;
  capacity: PlanCapacityForUI | null;
}) {
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
        >
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <path d="M3 10h18M8 14h8" />
        </svg>
      </div>
      <h2 className="font-display text-ink text-[18px] font-semibold">No shows yet</h2>
      <p className="text-muted mx-auto mt-2 max-w-[480px] text-[13px]">
        {hasClients
          ? "A show is one podcast — episodes and the voice profile live underneath. Pick the client it belongs to and add the first one."
          : "Shows need a parent client first. Add a client to unlock show creation."}
      </p>
      <div className="mt-5 inline-flex items-center gap-2">
        {hasClients ? (
          <NewShowButton clients={pickerClients} capacity={capacity} />
        ) : (
          <Link
            href="/clients"
            className="bg-accent shadow-card inline-flex items-center gap-[7px] rounded-lg px-[14px] py-[8px] font-sans text-[13px] font-semibold text-white transition-[filter] hover:brightness-95"
          >
            Add a client
            <svg
              width="12"
              height="12"
              viewBox="0 0 13 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 3l4 3.5L5 10" />
            </svg>
          </Link>
        )}
      </div>
    </div>
  );
}
