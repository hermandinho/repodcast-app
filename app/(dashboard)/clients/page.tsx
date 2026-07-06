import { NewClientButton } from "@/components/clients/new-client-button";
import { ClientsBrowser, type ClientWithStats } from "@/components/clients/clients-browser";
import { isLiveDb, listClientsForUI, listShowsForUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { unreadPortalFeedbackByClient } from "@/server/db/client-portal";

/**
 * Customer clients list. Each row = one parent customer. A separate `/shows`
 * route lists individual podcast shows across all clients.
 *
 * Phase 3.8 — the sidebar surfaces an unread portal-feedback badge on this
 * item. Landing here needs to answer "where is that feedback and what do I
 * do about it": we fetch per-client unread counts, thread them through the
 * browser so client cards with pending notes float to the top with an
 * inline pill, and render a summary strip at the top explaining the trail.
 */
export default async function ClientsPage() {
  const tenant = await resolveTenantContext();
  const [clients, shows, unreadByClient] = await Promise.all([
    listClientsForUI(tenant),
    listShowsForUI(tenant),
    isLiveDb()
      ? unreadPortalFeedbackByClient(tenant).catch(() => new Map<string, number>())
      : Promise.resolve(new Map<string, number>()),
  ]);

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
      unreadFeedback: unreadByClient.get(c.key) ?? 0,
    };
  });

  const totalUnread = Array.from(unreadByClient.values()).reduce((a, b) => a + b, 0);
  const clientsWithUnread = clientsWithStats.filter((c) => c.unreadFeedback > 0).length;

  return (
    <div className="px-4 pt-5 pb-14 sm:px-6 sm:pt-6 md:px-[30px] md:pt-[28px] md:pb-[60px]">
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

      {totalUnread > 0 && (
        <UnreadFeedbackStrip totalUnread={totalUnread} clientsWithUnread={clientsWithUnread} />
      )}

      {clients.length === 0 ? <ClientsEmptyState /> : <ClientsBrowser clients={clientsWithStats} />}
    </div>
  );
}

/**
 * Top-of-page hint that appears only when at least one client has unread
 * portal feedback. Explains what the sidebar badge meant and points at the
 * client cards below (which are already floated to the top by the
 * browser's sort). No CTA button — the cards themselves are the target.
 */
function UnreadFeedbackStrip({
  totalUnread,
  clientsWithUnread,
}: {
  totalUnread: number;
  clientsWithUnread: number;
}) {
  return (
    <div
      className="mb-[18px] flex items-start gap-3 rounded-2xl border px-4 py-[14px]"
      style={{ borderColor: "#D8E1F3", background: "rgba(58,91,160,0.05)" }}
    >
      <div
        className="mt-[2px] flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
        style={{ background: "#3A5BA0", color: "white" }}
        aria-hidden
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M2 3.5h8v5H4.5L2 10.5V3.5z" />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-display text-ink text-[14px] font-semibold">
          {totalUnread} unread portal note{totalUnread === 1 ? "" : "s"} from {clientsWithUnread}{" "}
          client{clientsWithUnread === 1 ? "" : "s"}
        </div>
        <p className="text-muted mt-[3px] text-[12.5px] leading-[1.5]">
          Open the affected client below and jump to their{" "}
          <span className="font-medium">Billing</span> tab — the feedback inbox sits above the
          deliverable ledger. Clients with pending notes are highlighted and floated to the top.
        </p>
      </div>
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
