import "server-only";

import { MemberRole, Plan, type Agency } from "@prisma/client";
import { z } from "zod";
import { NotFoundError } from "@/server/auth/errors";
import { requireRole, type TenantContext } from "@/server/auth/tenant";
import { sendWelcomeEmail } from "@/server/email/send";
import { prisma } from "./client";

export const createAgencyInput = z.object({
  agencyName: z.string().min(1).max(120),
  plan: z.nativeEnum(Plan).default(Plan.STUDIO),
});
export type CreateAgencyInput = z.infer<typeof createAgencyInput>;

export const updateAgencyInput = z.object({
  name: z.string().min(1).max(120),
});
export type UpdateAgencyInput = z.infer<typeof updateAgencyInput>;

/**
 * Phase 2.13.6 — renewals-reminder toggle. Lives as its own input so the
 * one-checkbox form on /settings/agency stays simple and the existing
 * name-rename flow doesn't need to know about it.
 */
export const updateRenewalRemindersInput = z.object({
  enabled: z.boolean(),
});
export type UpdateRenewalRemindersInput = z.infer<typeof updateRenewalRemindersInput>;

const WRITE_ROLES = [MemberRole.OWNER, MemberRole.ADMIN] as const;

export type CreateAgencyForUserInput = CreateAgencyInput & {
  clerkUserId: string;
  email: string;
  name: string | null;
};

/**
 * Self-service agency creation (Phase 1.0).
 *
 * Lifecycle:
 *   1. Single interactive `$transaction` creates the `Agency` row and the
 *      founding `Member` row (role `OWNER`). These two must land together —
 *      an Agency without a member is unreachable through `getAuthContext`
 *      and would route the user back to /onboarding next time.
 *   2. Best-effort: fire `sendWelcomeEmail`. Never block signup on email.
 *
 * Invites no longer flow through Clerk Organizations (homegrown
 * `MemberInvite` model replaced that — see `server/db/invites.ts`), so we
 * don't provision a Clerk Org alongside the agency anymore. The legacy
 * `Agency.clerkOrgId` field stays on the schema for existing rows but is
 * not written on new agencies.
 */
export async function createAgencyForUser(input: CreateAgencyForUserInput): Promise<Agency> {
  const agency = await prisma.$transaction(async (tx) => {
    const created = await tx.agency.create({
      data: {
        name: input.agencyName,
        plan: input.plan,
      },
    });
    await tx.member.create({
      data: {
        agencyId: created.id,
        clerkUserId: input.clerkUserId,
        role: MemberRole.OWNER,
        email: input.email,
        name: input.name,
      },
    });
    return created;
  });

  // Best-effort welcome email.
  if (input.email && !input.email.endsWith("@clerk.local")) {
    void sendWelcomeEmail(input.email, {
      firstName: input.name?.split(" ")[0] ?? "there",
      agencyName: agency.name,
      dashboardUrl: dashboardBaseUrl(),
    });
  }

  return agency;
}

function dashboardBaseUrl(): string {
  return (
    (process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")) +
    "/dashboard"
  );
}

/**
 * Cheap "does this user belong to any agency yet?" check — drives the
 * onboarding redirect in the dashboard layout and the inverse redirect in
 * the onboarding layout.
 */
export async function userHasAnyMembership(clerkUserId: string): Promise<boolean> {
  const found = await prisma.member.findFirst({
    where: { clerkUserId },
    select: { id: true },
  });
  return found !== null;
}

/**
 * Self-service rename of the active agency. OWNER/ADMIN only. Plan changes
 * still flow through Stripe checkout via `/settings/billing` — this writes
 * only the user-controllable display name.
 *
 * `updateMany` is used so the tenant filter is enforced atomically; a
 * cross-tenant id collapses to a 0-count miss which we surface as `NotFoundError`.
 */
export async function updateAgency(ctx: TenantContext, patch: UpdateAgencyInput): Promise<Agency> {
  requireRole(ctx, WRITE_ROLES);
  const { count } = await prisma.agency.updateMany({
    where: { id: ctx.agencyId },
    data: { name: patch.name },
  });
  if (count === 0) throw new NotFoundError(`Agency ${ctx.agencyId} not found`);
  return prisma.agency.findUniqueOrThrow({ where: { id: ctx.agencyId } });
}

/**
 * Phase 2.13.6 — flip the renewals-reminder cron's per-agency mute switch.
 * Same role gate as `updateAgency` (OWNER/ADMIN); `updateMany` keeps the
 * write tenant-scoped atomically (a 0-count → NotFoundError).
 */
export async function updateRenewalReminders(
  ctx: TenantContext,
  patch: UpdateRenewalRemindersInput,
): Promise<Agency> {
  requireRole(ctx, WRITE_ROLES);
  const { count } = await prisma.agency.updateMany({
    where: { id: ctx.agencyId },
    data: { renewalRemindersEnabled: patch.enabled },
  });
  if (count === 0) throw new NotFoundError(`Agency ${ctx.agencyId} not found`);
  return prisma.agency.findUniqueOrThrow({ where: { id: ctx.agencyId } });
}
