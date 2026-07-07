import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { FeedbackButton } from "@/components/dashboard/feedback-button";
import { ImpersonationBanner } from "@/components/dashboard/impersonation-banner";
import { TrialBanner } from "@/components/dashboard/trial-banner";
import { NavDrawerProvider } from "@/components/shell/nav-drawer-context";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { getAuthContext } from "@/server/auth/context";
import { hasActiveAccess } from "@/server/billing/limits";
import { isLiveDb } from "@/server/data/source";

// Module-level helpers — kept out of the component body so the react-hooks/
// purity rule doesn't flag `Date.now()` as impure inside render.
function daysUntil(target: Date): number {
  const ms = target.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}
function formatShortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Dashboard gate (Phase 3.x onboarding rebuild).
 *
 * Two gates, checked off a single `getAuthContext` payload:
 *   1. Signed in and belongs to an agency? If not → /onboarding (the
 *      router decides between workspace vs plan substep).
 *   2. Agency clears `hasActiveAccess` (live Stripe sub OR unexpired
 *      ROOT-granted comp window)? If not → same, the router forwards
 *      to /onboarding/plan. `/settings/*` is exempt so a user whose
 *      subscription was just canceled can still reach Billing (to
 *      resubscribe) or the Agency danger zone (to delete the
 *      workspace); otherwise the moment the Stripe webhook nulls
 *      `stripeSubscriptionId` they'd be trapped in onboarding.
 *
 * Sample-data mode skips both — the demo tenant is always "set up".
 *
 * Phase 3.6.6 — the same `getAuthContext` surfaces an `impersonation`
 * field when the request carries a valid envelope cookie. The orange
 * banner mounts above the main scroller so it's always visible.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const auth = isLiveDb() ? await getAuthContext() : null;
  const pathname = isLiveDb() ? ((await headers()).get("x-pathname") ?? "") : "";
  const isSettingsPath = pathname.startsWith("/settings");
  if (isLiveDb()) {
    if (!auth) redirect("/onboarding");
    if (!hasActiveAccess(auth.agency) && !isSettingsPath) redirect("/onboarding");
  }

  return (
    <NavDrawerProvider>
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
              actorRole={auth.impersonation.actorRole}
            />
          ) : null}
          {auth?.agency.trialStatus === "ACTIVE" && auth.agency.trialEndsAt ? (
            <TrialBanner
              plan={auth.agency.plan}
              daysLeft={daysUntil(auth.agency.trialEndsAt)}
              endsAtLabel={formatShortDate(auth.agency.trialEndsAt)}
            />
          ) : null}
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
        <FeedbackButton />
      </div>
    </NavDrawerProvider>
  );
}
