"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ValidationError } from "@/server/auth/errors";
import { Plan } from "@/lib/enums";
import { isLiveDb } from "@/server/data/source";
import { trackServer } from "@/server/analytics/track";
import { createAgencyForUser, userHasAnyMembership } from "@/server/db/agencies";
import { captureAttribution, type AttributionInput } from "@/server/db/attribution";

/**
 * Step 1 action — create the Agency + founding Member (OWNER) and forward
 * to the plan-picker substep.
 *
 * The agency starts with plan STUDIO + no Stripe subscription; the plan
 * substep is what actually books billing. This keeps the pre-Checkout
 * abandonment path clean: bailing here leaves an Agency without a sub,
 * which the dashboard gate keeps behind the paywall until the user comes
 * back and completes /onboarding/plan.
 */

const workspaceInput = z.object({
  agencyName: z.string().trim().min(1).max(120),
  passthroughQs: z.string().max(300).optional(),
});

export async function createWorkspaceAction(formData: FormData): Promise<void> {
  const parsed = workspaceInput.safeParse({
    agencyName: formData.get("agencyName"),
    passthroughQs: formData.get("passthroughQs") ?? undefined,
  });
  if (!parsed.success) {
    throw new ValidationError("Invalid workspace input", parsed.error.issues);
  }

  const suffix = parsed.data.passthroughQs ? `?${parsed.data.passthroughQs}` : "";

  if (!isLiveDb()) {
    // Sample-data mode: no DB write, just move on to plan.
    redirect(`/onboarding/plan${suffix}`);
  }

  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=%2Fonboarding%2Fworkspace");

  // Idempotency guard: refreshing the wizard should never create a second
  // Agency for the same Clerk user. If they already have a membership,
  // fall through to the plan step instead of creating a duplicate row.
  if (await userHasAnyMembership(userId)) {
    redirect(`/onboarding/plan${suffix}`);
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? `${userId}@clerk.local`;
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || null;

  const agency = await createAgencyForUser({
    agencyName: parsed.data.agencyName,
    plan: Plan.STUDIO,
    clerkUserId: userId,
    email,
    name,
  });

  // Persist the first-touch attribution captured client-side.
  // Best-effort: `captureAttribution` swallows its own errors so a
  // malformed cookie can't block onboarding. Cookie is purged after write
  // so a subsequent agency created on the same browser (dogfooding, test
  // accounts) doesn't re-tag onto the original visit.
  const cookieStore = await cookies();
  const attrCookie = cookieStore.get("repodcast_attr");
  if (attrCookie?.value) {
    const parsed = parseAttributionCookie(attrCookie.value);
    if (parsed) {
      await captureAttribution(agency.id, {
        ...parsed,
        signupPath: "/onboarding/workspace",
      });
    }
    cookieStore.delete("repodcast_attr");
  }

  // Funnel events. Fire before the redirect so PostHog gets both the
  // signup-completion signal AND the step-1 tick even if the plan page
  // 4xxs. `agency_created` is the /root/funnels row "Signup completed
  // (agency created)" — without it, the funnel row shows 0 forever.
  void trackServer(
    "agency_created",
    { agencyId: agency.id, plan: Plan.STUDIO },
    { distinctId: `agency:${agency.id}`, agencyId: agency.id },
  );
  void trackServer(
    "onboarding_step_completed",
    { agencyId: agency.id, step: 1, stepName: "workspace" },
    { distinctId: `agency:${agency.id}`, agencyId: agency.id },
  );

  redirect(`/onboarding/plan${suffix}`);
}

/**
 * Decode the first-party `repodcast_attr` cookie the client-side
 * `AttributionCapture` set on landing. Returns null on any decode or
 * shape failure — attribution is best-effort and a malformed cookie
 * must never derail signup.
 */
function parseAttributionCookie(raw: string): AttributionInput | null {
  try {
    const decoded = decodeURIComponent(raw);
    const parsed: unknown = JSON.parse(decoded);
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    return {
      utmSource: str(obj.utmSource),
      utmMedium: str(obj.utmMedium),
      utmCampaign: str(obj.utmCampaign),
      utmContent: str(obj.utmContent),
      utmTerm: str(obj.utmTerm),
      referrer: str(obj.referrer),
      landingPath: str(obj.landingPath),
      gclid: str(obj.gclid),
      fbclid: str(obj.fbclid),
    };
  } catch {
    return null;
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
