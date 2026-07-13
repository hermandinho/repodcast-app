import { requireSystemAdminContext } from "@/server/auth/system";
import { RootSidebar } from "@/components/root/root-sidebar";
import { RootTopbar } from "@/components/root/root-topbar";
import { NavDrawerProvider } from "@/components/shell/nav-drawer-context";

/**
 * Gate for all `/root/*` routes.
 *
 * `requireSystemAdminContext` enforces three things in order:
 *   1. Unauthenticated → redirect to `/sign-in`.
 *   2. Authenticated but no `SystemAdmin` row → `notFound()` (404). Surface
 *      stays invisible to non-admins.
 *   3. MFA missing (when enforced) → redirect to MFA setup.
 *
 * If any of those trips, we never reach the layout JSX.
 *
 * The chrome itself is deliberately separate from the tenant dashboard
 * (`app/(dashboard)/layout.tsx`) — different sidebar, red-tinted top bar —
 * so an operator never confuses ROOT MODE with their own agency view.
 *
 * Below `md` the sidebar collapses into an off-canvas drawer driven by
 * `NavDrawerProvider`; the burger in `RootTopbar` toggles it.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSystemAdminContext();

  return (
    <NavDrawerProvider>
      <div className="flex h-screen w-full overflow-hidden bg-zinc-950 text-zinc-100">
        <RootSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <RootTopbar ctx={ctx} />
          <main className="flex-1 overflow-y-auto bg-zinc-950 px-4 py-6 sm:px-6 md:p-8">
            {children}
          </main>
        </div>
      </div>
    </NavDrawerProvider>
  );
}
