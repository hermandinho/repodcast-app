import { redirect } from "next/navigation";
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
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (isLiveDb()) {
    const auth = await getAuthContext();
    if (!auth) redirect("/onboarding");
  }

  return (
    <div className="bg-canvas flex h-screen w-full overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
