import { redirect } from "next/navigation";
import { ImpersonationBanner } from "@/components/dashboard/impersonation-banner";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { getAuthContext } from "@/server/auth/context";
import { isLiveDb } from "@/server/data/source";

/**
 * Dashboard gate (Phase 3.x onboarding rebuild).
 *
 * Two gates, checked off a single `getAuthContext` payload:
 *   1. Signed in and belongs to an agency? If not → /onboarding (the
 *      router decides between workspace vs plan substep).
 *   2. Agency carries a Stripe `stripeSubscriptionId`? If not → same,
 *      the router forwards to /onboarding/plan.
 *
 * Sample-data mode skips both — the demo tenant is always "set up".
 *
 * Phase 3.6.6 — the same `getAuthContext` surfaces an `impersonation`
 * field when the request carries a valid envelope cookie. The orange
 * banner mounts above the main scroller so it's always visible.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const auth = isLiveDb() ? await getAuthContext() : null;
  if (isLiveDb()) {
    if (!auth) redirect("/onboarding");
    if (!auth.agency.stripeSubscriptionId) redirect("/onboarding");
  }

  return (
    <div className="bg-canvas flex h-screen w-full overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        {auth?.impersonation ? (
          <ImpersonationBanner
            agencyName={auth.agency.name}
            memberEmail={auth.impersonation.as.email}
            memberName={auth.impersonation.as.name}
            mode={auth.impersonation.mode}
          />
        ) : null}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
