"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { Plan } from "@prisma/client";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ValidationError } from "@/server/auth/errors";
import { createAgencyForUser, userHasAnyMembership } from "@/server/db/agencies";
import { isLiveDb } from "@/server/data/source";

export type OnboardingResult =
  { ok: true; data: { agencyId: string } } | { ok: false; error: string };

const createAgencyActionInput = z.object({
  agencyName: z.string().min(1).max(120),
  plan: z.nativeEnum(Plan).default(Plan.STUDIO),
});

/**
 * Self-service onboarding (Phase 1.0) — workspace setup only.
 *
 * Creates an Agency + the founding Member (role OWNER). Adding clients,
 * voice calibration, and the first episode are surfaced on the dashboard
 * via a guided empty-state card instead of being forced into a linear
 * funnel — agencies typically onboard several shows in a session.
 *
 * Defends against the obvious races:
 *  - Unauthenticated → middleware should never let us here, but we re-check
 *  - User already has a Member → refuses (so a double-submit can't create
 *    a second agency)
 */
export async function createAgencyAction(raw: unknown): Promise<OnboardingResult> {
  const parsed = createAgencyActionInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid agency input", parsed.error.issues);
  }

  // Sample-data mode: short-circuit so /onboarding still works on a fresh
  // clone without `DATABASE_URL`. Caller-side flow still routes to dashboard.
  if (!isLiveDb()) {
    return { ok: true, data: { agencyId: "demo" } };
  }

  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  if (await userHasAnyMembership(userId)) {
    return {
      ok: false,
      error: "You already belong to an agency. Refresh the page.",
    };
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? `${userId}@clerk.local`;
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || null;

  const agency = await createAgencyForUser({
    agencyName: parsed.data.agencyName,
    plan: parsed.data.plan,
    clerkUserId: userId,
    email,
    name,
  });

  return { ok: true, data: { agencyId: agency.id } };
}
