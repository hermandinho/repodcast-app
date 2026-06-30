import { redirect } from "next/navigation";
import { ImpersonationBanner } from "@/components/dashboard/impersonation-banner";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { getAuthContext } from "@/server/auth/context";
import { isLiveDb } from "@/server/data/source";

/**
 * Onboarding gate (Phase 1.0).
 *
 * Middleware (`middleware.ts`) already guarantees the user is signed in by
 * the time we reach this layout. What it can't cheaply check is whether the
 * signed-in user belongs to an agency yet — that's a DB lookup. We do it
 * here once per page render and redirect to /onboarding if not.
 *
 * Sample-data mode (`!isLiveDb()`) skips the check: the synthetic tenant
 * makes every page look "set up" so the design experience works on a fresh
 * clone with no env vars.
 *
 * Phase 3.6.6 — the same `getAuthContext` call surfaces an `impersonation`
 * field when the request carries a valid envelope cookie. The orange
 * banner mounts above the main scroller so it's always visible.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const auth = isLiveDb() ? await getAuthContext() : null;
  if (isLiveDb() && !auth) redirect("/onboarding");

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
