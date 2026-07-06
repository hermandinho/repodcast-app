import Link from "next/link";
import { BrandMark } from "@/components/landing/nav";
import { getAuthContext } from "@/server/auth/context";
import { toTenantContext } from "@/server/auth/tenant";
import { isLiveDb } from "@/server/data/source";
import { countUnreadPortalFeedbackForAgency } from "@/server/db/client-portal";
import { navItems } from "./nav-items";
import { NavLink } from "./nav-link";
import { SidebarShell } from "./sidebar-shell";

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

/**
 * Dashboard sidebar — revamp visual system (see `ref/UI/Revamp/`).
 *
 * Layout deltas vs the classic sidebar:
 *   - Width `--sidebar-width` (248px) matches the ref grid so the settings
 *     tab pill + trial banner + topbar line up cleanly at 1440px.
 *   - Logo section uses the shared `<BrandMark darkBg />` — our real logo,
 *     not the ref mock's blue three-bar tile. `darkBg` swaps the tile fill
 *     to `#3A5BA0` (our accent) so it reads against the ink sidebar.
 *   - Section rubric "WORKSPACE" renders in `--font-revamp-mono` (Spline
 *     Sans Mono) with wide letter-spacing.
 *   - Nav items render at 14px with a 12px gap between icon and label; the
 *     active row carries an accent-tinted background plus a 2px left border
 *     in `--color-accent`. Active-row styling moved into `<NavLink>`.
 *   - Bottom user pill sits above a top border and shows a 32×32 accent
 *     avatar circle with initials, name, and role · agency subtitle.
 */
export async function Sidebar() {
  const ctx = await getAuthContext();

  // Phase 3.8 — agency-wide unread portal feedback drives the badge on the
  // Clients nav item. Gated on `isLiveDb()` + a live tenant context; sample-
  // data mode and unauthed edges collapse to zero (badge stays hidden).
  const unreadFeedbackCount =
    ctx && isLiveDb()
      ? await countUnreadPortalFeedbackForAgency(toTenantContext(ctx)).catch(() => 0)
      : 0;

  const badgeByHref: Record<string, number> = { "/clients": unreadFeedbackCount };

  return (
    <SidebarShell>
      {/* Logo row — matches ref padding (20px 22px). BrandMark carries the
          three-bar SVG lockup that's already our brand. */}
      <div className="flex items-center" style={{ gap: 10, padding: "20px 22px" }}>
        <Link
          href="/dashboard"
          className="flex items-center no-underline transition-opacity hover:opacity-90"
          aria-label="Repodcast dashboard"
        >
          <BrandMark darkBg />
        </Link>
      </div>

      {/* Section rubric — mono, wide-tracked, muted */}
      <div
        style={{
          fontFamily: "var(--font-revamp-mono)",
          fontSize: 10.5,
          letterSpacing: "0.14em",
          color: "var(--color-sidebar-label)",
          padding: "18px 22px 8px",
        }}
      >
        WORKSPACE
      </div>

      <nav className="flex flex-col" style={{ gap: 2, padding: "0 12px" }}>
        {navItems.map((item) => (
          <NavLink key={item.href} item={item} badgeCount={badgeByHref[item.href] ?? 0} />
        ))}
      </nav>

      <div
        className="mt-auto flex items-center"
        style={{
          padding: 16,
          gap: 10,
          borderTop: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div
          className="grid place-items-center rounded-full"
          style={{
            width: 32,
            height: 32,
            background: "var(--color-accent)",
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {ctx ? initialsFor(ctx.user.name, ctx.user.email) : "·"}
        </div>
        <div className="min-w-0">
          <div className="truncate" style={{ fontSize: 13.5, fontWeight: 600, color: "#EAEFF6" }}>
            {ctx?.user.name ?? ctx?.user.email ?? "Signed out"}
          </div>
          <div className="truncate" style={{ fontSize: 11.5, color: "var(--color-sidebar-label)" }}>
            {ctx ? `${roleLabel(ctx.member.role)} · ${ctx.agency.name}` : "No active workspace"}
          </div>
        </div>
      </div>
    </SidebarShell>
  );
}
