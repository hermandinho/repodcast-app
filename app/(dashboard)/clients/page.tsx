import { NewClientButton } from "@/components/clients/new-client-button";
import { ClientsBrowser, type ClientWithStats } from "@/components/clients/clients-browser";
import { listClientsForUI, listShowsForUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";

/**
 * Customer clients list. Each row = one parent customer. A separate `/shows`
 * route lists individual podcast shows across all clients.
 */
export default async function ClientsPage() {
  const tenant = await resolveTenantContext();
  const [clients, shows] = await Promise.all([listClientsForUI(tenant), listShowsForUI(tenant)]);

  // Roll up per-client aggregates from the show list once. The browser uses
  // these for the card stats and as sort keys.
  const aggByClient = new Map<string, { shows: number; episodes: number; samples: number }>();
  for (const s of shows) {
    const prev = aggByClient.get(s.clientKey) ?? { shows: 0, episodes: 0, samples: 0 };
    aggByClient.set(s.clientKey, {
      shows: prev.shows + 1,
      episodes: prev.episodes + s.episodeCount,
      samples: prev.samples + s.samples,
    });
  }

  const clientsWithStats: ClientWithStats[] = clients.map((c) => {
    const agg = aggByClient.get(c.key) ?? { shows: 0, episodes: 0, samples: 0 };
    return {
      key: c.key,
      name: c.name,
      description: c.description,
      contactName: c.contactName,
      contactEmail: c.contactEmail,
      artworkUrl: c.artworkUrl,
      initial: c.initial,
      avatarBg: c.avatarBg,
      showCount: agg.shows,
      episodeCount: agg.episodes,
      voiceSamples: agg.samples,
    };
  });

  return (
    <div className="px-[30px] pt-[28px] pb-[60px]">
      <div className="mb-[22px] flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-ink text-[25px] font-semibold tracking-[-0.5px]">
            Clients
          </h1>
          <p className="text-muted mt-[6px] text-[14px]">
            {clients.length} client{clients.length === 1 ? "" : "s"} · {shows.length} show
            {shows.length === 1 ? "" : "s"}
          </p>
        </div>
        <NewClientButton />
      </div>

      {clients.length === 0 ? <ClientsEmptyState /> : <ClientsBrowser clients={clientsWithStats} />}
    </div>
  );
}

function ClientsEmptyState() {
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
          <path d="M4 20v-1.5A4.5 4.5 0 0 1 8.5 14h7a4.5 4.5 0 0 1 4.5 4.5V20" />
          <circle cx="12" cy="8" r="3.5" />
        </svg>
      </div>
      <h2 className="font-display text-ink text-[18px] font-semibold">No clients yet</h2>
      <p className="text-muted mx-auto mt-2 max-w-[460px] text-[13px]">
        Clients are the agencies or companies you produce content for. Each client owns one or more
        shows — you&apos;ll add those next.
      </p>
      <div className="mt-5 inline-flex">
        <NewClientButton />
      </div>
    </div>
  );
}
