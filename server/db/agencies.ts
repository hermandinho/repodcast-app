import "server-only";

import { MemberRole, Plan, type Agency } from "@prisma/client";
import { z } from "zod";
import { NotFoundError } from "@/server/auth/errors";
import { requireRole, type TenantContext } from "@/server/auth/tenant";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { assertMinPlan, getAgencyPlan } from "@/server/billing/limits";
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

/**
 * Phase 2.9-followup — preferred display + checkout currency. Bounded to
 * SUPPORTED_CURRENCIES at the action layer (the DB column is free-form so
 * we can add currencies without a migration).
 */
export const updatePreferredCurrencyInput = z.object({
  currency: z.enum(SUPPORTED_CURRENCIES),
});
export type UpdatePreferredCurrencyInput = z.infer<typeof updatePreferredCurrencyInput>;

/**
 * Phase 2.5 — white-label settings (logo + accent color). Both fields
 * are independently nullable so the agency can opt in to either piece.
 * Empty strings collapse to `null` so a "clear" gesture from the form
 * lands as a real unset rather than an empty string in the DB.
 *
 * Accent color is constrained to 7-char hex (`#RRGGBB`) at the input
 * layer; the DB column accepts any string so we can extend later.
 *
 * Empties are normalised *before* the URL / regex validators run via
 * `z.preprocess` — otherwise an empty form field would trip `.url()`
 * even though we treat empties as a clear gesture.
 */
const emptyToNull = (v: unknown) => (typeof v === "string" && v.trim().length === 0 ? null : v);

export const updateAgencyBrandingInput = z.object({
  brandLogoUrl: z.preprocess(
    emptyToNull,
    z
      .string()
      .url()
      .nullish()
      .transform((v) => v ?? null),
  ),
  brandAccentColor: z.preprocess(
    emptyToNull,
    z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/u, "Use a 6-digit hex color like #3A5BA0")
      .nullish()
      .transform((v) => (v ? v.toLowerCase() : null)),
  ),
});
export type UpdateAgencyBrandingInput = z.infer<typeof updateAgencyBrandingInput>;

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
 * Phase 3.x — snapshot used by the `/onboarding` router to decide which
 * substep to send the user to.
 *
 * Returns:
 *  - `{ kind: "no-membership" }` — user hasn't created an agency yet →
 *    /onboarding/workspace
 *  - `{ kind: "no-subscription", agencyId, agencyName, hadPriorSubscription }`
 *    — has agency but no live Stripe sub. `hadPriorSubscription` distinguishes
 *    a brand-new user who hasn't yet picked a plan (→ /onboarding/plan) from
 *    a returning user who canceled or let their trial expire (→
 *    /settings/billing, so they can either resubscribe or reach the danger
 *    zone to delete). Signalled by a non-null `stripeCustomerId`, which
 *    Stripe stamps on the very first Checkout Session — the same marker the
 *    trial-eligibility gate uses.
 *  - `{ kind: "paying", agencyId, agencyName }` — sub is live → /dashboard
 *
 * Scoped to the user's oldest agency, matching every other "which agency
 * are we onboarding" helper. Multi-agency membership is a separate flow.
 */
export type OnboardingStateForUser =
  | { kind: "no-membership" }
  | {
      kind: "no-subscription";
      agencyId: string;
      agencyName: string;
      hadPriorSubscription: boolean;
    }
  | { kind: "paying"; agencyId: string; agencyName: string };

export async function getOnboardingStateForUser(
  clerkUserId: string,
): Promise<OnboardingStateForUser> {
  // Prefer OWNER role first, then most-recently-updated for tie-breakers.
  // MUST match `getAuthContext` in `server/auth/context.ts` — divergence
  // between the two caused Bug 1 (an active-subscription client bounced
  // to /onboarding because this function returned the older non-paying
  // agency while getAuthContext returned the paying one).
  const member = await prisma.member.findFirst({
    where: { clerkUserId },
    orderBy: [{ role: "asc" }, { updatedAt: "desc" }],
    select: {
      agency: {
        select: {
          id: true,
          name: true,
          stripeSubscriptionId: true,
          stripeCustomerId: true,
        },
      },
    },
  });
  if (!member) return { kind: "no-membership" };
  const { agency } = member;
  if (agency.stripeSubscriptionId) {
    return { kind: "paying", agencyId: agency.id, agencyName: agency.name };
  }
  return {
    kind: "no-subscription",
    agencyId: agency.id,
    agencyName: agency.name,
    hadPriorSubscription: agency.stripeCustomerId !== null,
  };
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

/**
 * Self-service preferred-currency setter. Pairs with the currency picker on
 * /settings/billing. Same OWNER/ADMIN gate; `updateMany` keeps the write
 * tenant-scoped atomically.
 */
export async function updatePreferredCurrency(
  ctx: TenantContext,
  patch: UpdatePreferredCurrencyInput,
): Promise<Agency> {
  requireRole(ctx, WRITE_ROLES);
  const { count } = await prisma.agency.updateMany({
    where: { id: ctx.agencyId },
    data: { preferredCurrency: patch.currency },
  });
  if (count === 0) throw new NotFoundError(`Agency ${ctx.agencyId} not found`);
  return prisma.agency.findUniqueOrThrow({ where: { id: ctx.agencyId } });
}

/**
 * Phase 2.5 — agency white-label branding setter. OWNER/ADMIN only, and
 * gated to Agency+ plans (Studio is the entry tier; white-label is one of
 * the AGENCY-and-up differentiators). `updateMany` keeps the write
 * tenant-scoped atomically. Empty values are coerced to NULL by the Zod
 * input so a "clear" gesture lands as a real unset (UI falls back to
 * Repodcast defaults on null).
 */
export async function updateAgencyBranding(
  ctx: TenantContext,
  patch: UpdateAgencyBrandingInput,
): Promise<Agency> {
  requireRole(ctx, WRITE_ROLES);
  const plan = await getAgencyPlan(ctx.agencyId);
  assertMinPlan(plan, Plan.NETWORK);
  const { count } = await prisma.agency.updateMany({
    where: { id: ctx.agencyId },
    data: {
      brandLogoUrl: patch.brandLogoUrl,
      brandAccentColor: patch.brandAccentColor,
    },
  });
  if (count === 0) throw new NotFoundError(`Agency ${ctx.agencyId} not found`);
  return prisma.agency.findUniqueOrThrow({ where: { id: ctx.agencyId } });
}
