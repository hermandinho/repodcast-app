import { getAuthContext } from "@/server/auth/context";
import { toTenantContext } from "@/server/auth/tenant";
import { isLiveDb } from "@/server/data/source";
import { countUnreadPortalFeedbackForAgency } from "@/server/db/client-portal";
import { navItems } from "./nav-items";
import { NavLink } from "./nav-link";

function initialsFor(name: string | null, email: string): string {
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
    if (letters.length > 0) return letters.join("");
  }
  return (email[0] ?? "?").toUpperCase();
}

function roleLabel(role: string): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

export async function Sidebar() {
  const ctx = await getAuthContext();

  // Phase 3.8 — agency-wide unread portal feedback drives the badge on the
  // Clients nav item. Gated on `isLiveDb()` + a live tenant context; sample-
  // data mode and unauthed edges collapse to zero (badge stays hidden).
  // Any DB blip degrades the same way — never break the shell.
  const unreadFeedbackCount =
    ctx && isLiveDb()
      ? await countUnreadPortalFeedbackForAgency(toTenantContext(ctx)).catch(() => 0)
      : 0;

  const badgeByHref: Record<string, number> = { "/clients": unreadFeedbackCount };

  return (
    <aside
      className="bg-sidebar text-sidebar-text flex flex-shrink-0 flex-col px-[14px] py-[18px]"
      style={{ width: "var(--sidebar-width)" }}
    >
      <div className="flex items-center gap-[10px] px-2 pt-[6px] pb-[22px]">
        <div className="bg-accent font-display flex h-[30px] w-[30px] items-center justify-center rounded-md text-[16px] font-bold text-white">
          R
        </div>
        <div className="font-display text-[16px] font-semibold tracking-[-0.2px] text-white">
          Repodcast
        </div>
      </div>

      <div className="text-sidebar-label px-[10px] pt-[6px] pb-2 font-sans text-[10.5px] font-semibold tracking-[0.09em] uppercase">
        Workspace
      </div>

      <nav className="flex flex-col gap-[2px]">
        {navItems.map((item) => (
          <NavLink key={item.href} item={item} badgeCount={badgeByHref[item.href] ?? 0} />
        ))}
      </nav>

      <div className="mt-auto flex items-center gap-[10px] rounded-[10px] bg-white/[0.04] p-[11px]">
        <div className="bg-sidebar-user flex h-8 w-8 items-center justify-center rounded-md font-sans text-[12px] font-semibold text-[#CDD7E8]">
          {ctx ? initialsFor(ctx.user.name, ctx.user.email) : "·"}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-[#EAEFF6]">
            {ctx?.user.name ?? ctx?.user.email ?? "Signed out"}
          </div>
          <div className="truncate text-[11.5px] text-[#6C7C98]">
            {ctx ? `${roleLabel(ctx.member.role)} · ${ctx.agency.name}` : "No active workspace"}
          </div>
        </div>
      </div>
    </aside>
  );
}
