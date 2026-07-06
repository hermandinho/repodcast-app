import { UserButton } from "@clerk/nextjs";
import { getAuthContext } from "@/server/auth/context";
import { listClientsForUI, listShowsForUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { ClientSwitcher, type ClientWithCounts } from "./client-switcher";
import { NavToggle } from "./nav-toggle";

/**
 * Dashboard topbar — revamp visual system (see `ref/UI/Revamp/`).
 *
 * Left cluster: agency name (15/700), thin vertical divider (18px tall),
 * `<ClientSwitcher>` rendered as a bordered dropdown pill.
 * Right cluster: `+ New episode` primary button (our accent, 8px radius,
 * 9/16 padding) and Clerk's `<UserButton>` avatar (32px). Solid white bg
 * with a hairline bottom border matches ref.
 */
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

  return (
    <header
      className="z-20 flex flex-shrink-0 items-center justify-between px-4 py-[10px] sm:px-6 md:px-8 md:py-3"
      style={{
        background: "#ffffff",
        borderBottom: "1px solid #eef1f6",
        fontFamily: "var(--font-revamp-sans)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3 sm:gap-[14px]">
        {/* Burger opens the sidebar drawer below md; hidden at md+ where
            the sidebar is always visible inline. */}
        <NavToggle />
        <span className="truncate text-[14px] font-bold text-[#0a1e3c] sm:text-[15px]">
          {agencyName}
        </span>
        <span
          aria-hidden
          className="hidden sm:block"
          style={{ width: 1, height: 18, background: "#e4e9f1" }}
        />
        <div className="hidden min-w-0 sm:block">
          <ClientSwitcher clients={clients} showsByKey={showsByKey} />
        </div>
      </div>

      <div className="ml-auto flex flex-shrink-0 items-center" style={{ gap: 12 }}>
        {/*<Link*/}
        {/*  href="/episodes/new"*/}
        {/*  aria-label="New episode"*/}
        {/*  className="inline-flex items-center no-underline transition-[filter] hover:brightness-95"*/}
        {/*  style={{*/}
        {/*    background: "var(--color-accent)",*/}
        {/*    color: "#ffffff",*/}
        {/*    fontWeight: 600,*/}
        {/*    fontSize: 13.5,*/}
        {/*    padding: "9px 16px",*/}
        {/*    borderRadius: 8,*/}
        {/*    gap: 7,*/}
        {/*    fontFamily: "inherit",*/}
        {/*  }}*/}
        {/*>*/}
        {/*  <svg*/}
        {/*    width="13"*/}
        {/*    height="13"*/}
        {/*    viewBox="0 0 13 13"*/}
        {/*    fill="none"*/}
        {/*    stroke="currentColor"*/}
        {/*    strokeWidth="2"*/}
        {/*    strokeLinecap="round"*/}
        {/*    aria-hidden*/}
        {/*  >*/}
        {/*    <path d="M6.5 2.5v8M2.5 6.5h8" />*/}
        {/*  </svg>*/}
        {/*  <span className="hidden sm:inline">New episode</span>*/}
        {/*</Link>*/}
        <UserButton
          appearance={{
            elements: {
              avatarBox: { width: 32, height: 32 },
            },
          }}
        />
      </div>
    </header>
  );
}
