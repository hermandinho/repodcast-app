import Link from "next/link";
import { getAuthContext } from "@/server/auth/context";
import { listShowsForUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { ClientSwitcher } from "./client-switcher";

export async function Topbar() {
  const [auth, tenant] = await Promise.all([getAuthContext(), resolveTenantContext()]);
  // The "ClientSwitcher" is semantically a show switcher in the new
  // hierarchy — kept the component name to avoid touching every URL.
  const clients = await listShowsForUI(tenant);
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

      <ClientSwitcher clients={clients} />

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
