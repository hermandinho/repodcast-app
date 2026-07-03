"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ValidationError } from "@/server/auth/errors";
import { Plan } from "@/lib/enums";
import { isLiveDb } from "@/server/data/source";
import { createAgencyForUser, userHasAnyMembership } from "@/server/db/agencies";

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

  await createAgencyForUser({
    agencyName: parsed.data.agencyName,
    plan: Plan.STUDIO,
    clerkUserId: userId,
    email,
    name,
  });

  redirect(`/onboarding/plan${suffix}`);
}
