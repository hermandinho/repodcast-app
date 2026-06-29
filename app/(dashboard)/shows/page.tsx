import Link from "next/link";
import { VoiceStrengthBars } from "@/components/ui/voice-strength-bars";
import { NewShowButton } from "@/components/shows/new-show-button";
import { loadCapacityForUI, type PlanCapacityForUI } from "@/server/billing/limits";
import { isLiveDb, listClientsForUI, listShowsForUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { voiceLabel, voiceTextColor } from "@/lib/sample-data/voice-strength";

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
  const clientByKey = new Map(clients.map((c) => [c.key, c]));
  const pickerClients = clients.map((c) => ({ id: c.key, name: c.name }));

  return (
    <div className="px-[30px] pt-[28px] pb-[60px]">
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
        <div
          className="grid gap-[18px]"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(296px, 1fr))" }}
        >
          {shows.map((show) => {
            const client = clientByKey.get(show.clientKey);
            return (
              <Link
                key={show.key}
                href={`/shows/${show.key}`}
                className="group border-border bg-surface shadow-card hover:border-border-2 hover:shadow-card-hover block overflow-hidden rounded-3xl border text-left transition-shadow"
              >
                <div
                  className="relative h-[120px] overflow-hidden"
                  style={{ background: show.avatarBg }}
                >
                  {show.artworkUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={show.artworkUrl}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div
                      className="flex h-full w-full items-center justify-center"
                      style={{ boxShadow: "inset 0 -40px 60px rgba(0,0,0,.18)" }}
                    >
                      <span className="font-display text-[40px] font-bold tracking-[-1px] text-white/95">
                        {show.initial}
                      </span>
                    </div>
                  )}
                  {/* Bottom-edge gradient keeps the floating label readable on top of any artwork. */}
                  <div
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(to bottom, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%)",
                    }}
                  />
                  <span className="absolute bottom-3 left-[14px] font-sans text-[11px] font-medium tracking-[0.08em] text-white/85 uppercase">
                    Podcast
                  </span>
                  <span className="rounded-pill absolute top-3 right-3 bg-black/30 px-[9px] py-[3px] font-sans text-[11px] font-semibold text-white backdrop-blur-sm">
                    {show.episodeCount} ep
                  </span>
                </div>

                <div className="p-4">
                  <div className="font-display text-ink text-[15.5px] leading-tight font-semibold">
                    {show.name}
                  </div>
                  <div className="text-muted-2 mt-[3px] text-[12.5px]">
                    {show.host}
                    {client && (
                      <>
                        <span className="text-[#CBD4E2]"> · </span>
                        <span className="text-muted">{client.name}</span>
                      </>
                    )}
                  </div>

                  <div className="mt-[15px] flex items-center justify-between">
                    <span className="text-subtle font-sans text-[11px] font-semibold tracking-[0.05em] uppercase">
                      Voice
                    </span>
                    <span
                      className="font-sans text-[12px] font-semibold"
                      style={{ color: voiceTextColor(show.samples) }}
                    >
                      {voiceLabel(show.samples)} · {show.samples}
                    </span>
                  </div>
                  <div className="mt-2">
                    <VoiceStrengthBars samples={show.samples} />
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
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
