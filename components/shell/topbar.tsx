import Link from "next/link";
import { getAuthContext } from "@/server/auth/context";
import { listClientsForUI, listShowsForUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { ClientSwitcher, type ClientWithCounts } from "./client-switcher";

export async function Topbar() {
  const [auth, tenant] = await Promise.all([getAuthContext(), resolveTenantContext()]);

  // Header dropdown is a CLIENT picker. We also need the show list so the
  // active selection survives on `/shows/[key]` and `/voice/[showKey]`
  // (each show's `clientKey` maps the URL back to its owning client).
  const [clientsRaw, shows] = await Promise.all([listClientsForUI(tenant), listShowsForUI(tenant)]);

  const clients: ClientWithCounts[] = clientsRaw.map((c) => {
    const owned = shows.filter((s) => s.clientKey === c.key);
    return {
      ...c,
      showCount: owned.length,
      episodeCount: owned.reduce((sum, s) => sum + s.episodeCount, 0),
    };
  });

  const showsByKey: Record<string, string> = Object.fromEntries(
    shows.map((s) => [s.key, s.clientKey]),
  );

  const agencyName = auth?.agency.name ?? "Northbeam Studio";
  const agencyInitial = (agencyName[0] ?? "·").toUpperCase();

  return (
    <header
      className="border-border bg-surface z-20 flex flex-shrink-0 items-center gap-[18px] border-b px-[26px]"
      style={{ height: "var(--topbar-height)" }}
    >
      <div className="flex items-center gap-[10px]">
        <div className="bg-ink font-display flex h-[22px] w-[22px] items-center justify-center rounded-md text-[11px] font-bold text-white">
          {agencyInitial}
        </div>
        <span className="font-display text-ink text-[15px] font-semibold">{agencyName}</span>
      </div>

      <div className="bg-border h-6 w-px" />

      <ClientSwitcher clients={clients} showsByKey={showsByKey} />

      <div className="ml-auto flex items-center gap-[10px]">
        <Link
          href="/episodes/new"
          className="bg-accent shadow-card inline-flex items-center gap-[7px] rounded-[10px] px-[14px] py-[8px] font-sans text-[13px] font-semibold text-white transition-[filter] hover:brightness-95"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M6.5 2.5v8M2.5 6.5h8" />
          </svg>
          New episode
        </Link>
      </div>
    </header>
  );
}
