import Link from "next/link";
import { NewClientButton } from "@/components/clients/new-client-button";
import { listClientsForUI, listShowsForUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";

/**
 * Customer clients list. Each row = one parent customer. A separate `/shows`
 * route lists individual podcast shows across all clients.
 */
export default async function ClientsPage() {
  const tenant = await resolveTenantContext();
  const [clients, shows] = await Promise.all([listClientsForUI(tenant), listShowsForUI(tenant)]);
  const showsByClient = new Map<string, number>();
  for (const s of shows) {
    showsByClient.set(s.clientKey, (showsByClient.get(s.clientKey) ?? 0) + 1);
  }

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

      {clients.length === 0 ? (
        <ClientsEmptyState />
      ) : (
        <div
          className="grid gap-[18px]"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(296px, 1fr))" }}
        >
          {clients.map((c) => (
            <Link
              key={c.key}
              href={`/clients/${c.key}`}
              className="group border-border bg-surface shadow-card hover:border-border-2 hover:shadow-card-hover block overflow-hidden rounded-3xl border p-5 transition-shadow"
            >
              <div className="flex items-center gap-3">
                {c.artworkUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.artworkUrl}
                    alt=""
                    className="h-12 w-12 flex-shrink-0 rounded-xl object-cover"
                    style={{ background: "#EEF1F6" }}
                  />
                ) : (
                  <div
                    className="font-display flex h-12 w-12 items-center justify-center rounded-xl text-[15px] font-bold text-white"
                    style={{ background: c.avatarBg }}
                  >
                    {c.initial}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-display text-ink truncate text-[16px] leading-tight font-semibold">
                    {c.name}
                  </div>
                  {c.contactName && (
                    <div className="text-muted-2 mt-[2px] truncate text-[12.5px]">
                      {c.contactName}
                    </div>
                  )}
                </div>
              </div>
              {c.description && (
                <p className="text-muted mt-3 line-clamp-2 text-[12.5px] leading-[1.5]">
                  {c.description}
                </p>
              )}
              <div className="mt-4 flex items-center justify-between border-t border-[#F0F3F8] pt-3 text-[12px]">
                <span className="text-muted-2">
                  {showsByClient.get(c.key) ?? 0} show
                  {(showsByClient.get(c.key) ?? 0) === 1 ? "" : "s"}
                </span>
                <span className="text-accent group-hover:translate-x-[2px]">Open →</span>
              </div>
            </Link>
          ))}
        </div>
      )}
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
