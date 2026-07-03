import { UserButton } from "@clerk/nextjs";
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
      className="border-border bg-surface z-20 flex flex-shrink-0 items-center gap-3 border-b px-4 sm:gap-4 sm:px-5 md:gap-[18px] md:px-[26px]"
      style={{ height: "var(--topbar-height)" }}
    >
      {/* Agency badge + name. On mobile only the initial-badge renders so
          the ClientSwitcher has room to breathe. */}
      <div className="flex min-w-0 items-center gap-[10px]">
        <div className="bg-ink font-display flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white">
          {agencyInitial}
        </div>
        <span className="font-display text-ink hidden truncate text-[15px] font-semibold sm:inline">
          {agencyName}
        </span>
      </div>

      <div className="bg-border hidden h-6 w-px sm:block" />

      {/* ClientSwitcher — grows to fill the middle on wide viewports; on
          narrow ones min-w-0 lets its own truncation kick in. */}
      <div className="min-w-0 flex-1 sm:flex-none">
        <ClientSwitcher clients={clients} showsByKey={showsByKey} />
      </div>

      <div className="ml-auto flex flex-shrink-0 items-center gap-2 sm:gap-3 md:gap-[14px]">
        <Link
          href="/episodes/new"
          aria-label="New episode"
          className="bg-accent shadow-card inline-flex items-center gap-[7px] rounded-[10px] px-3 py-[8px] font-sans text-[13px] font-semibold text-white transition-[filter] hover:brightness-95 sm:px-[14px]"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M6.5 2.5v8M2.5 6.5h8" />
          </svg>
          <span className="hidden sm:inline">New episode</span>
        </Link>
        <UserButton
          appearance={{
            elements: {
              avatarBox: { width: 30, height: 30 },
            },
          }}
        />
      </div>
    </header>
  );
}
