"use server";

import { clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ForbiddenError, NotFoundError } from "@/server/auth/errors";
import {
  requireSystemAdminContext,
  SYSTEM_WRITE_ROLES,
  assertSystemRole,
} from "@/server/auth/system";
import { SYSTEM_AUDIT_ACTIONS } from "@/server/db/system/audit-actions";
import { withSystemAudit } from "@/server/db/system/audit";
import { prisma } from "@/server/db/client";
import { sendPasswordResetEmail, sendWelcomeEmail } from "@/server/email/send";

/**
 * Phase 3.6.9 — server actions behind `/root/users`.
 *
 * Two support-track ROOT actions:
 *   - resetPasswordAction — mints a Clerk sign-in token (one-click,
 *     ~1h TTL) and emails it to the user's primary address. The user
 *     lands in the dashboard without their old password, then sets a
 *     new one from Settings → Security.
 *   - resendWelcomeAction — re-emits the standard welcome email
 *     against one of the user's Member rows (agency + firstName come
 *     from that row).
 *
 * Both gated to ROOT + OPERATOR via `SYSTEM_WRITE_ROLES`. Every send
 * lands a `SystemAuditLog` row with the operator + target Clerk user
 * id, so an audit reader can reconstruct who nudged whom and when.
 *
 * External side-effects (Clerk sign-in token creation, Resend
 * dispatch) run OUTSIDE `withSystemAudit` — they can't be rolled back,
 * so we don't want them entangled with the audit-row transaction. The
 * audit call happens after the external work completes; the row's
 * `after` snapshot captures what actually shipped (link URL, subject).
 */

// ============================================================
// Reset password (sign-in token via Clerk)
// ============================================================

const SIGN_IN_TOKEN_TTL_SEC = 60 * 60; // 1 hour

export async function resetPasswordAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const clerkUserId = strOrEmpty(formData.get("clerkUserId"));
  if (!clerkUserId) {
    redirect("/root/users?error=missing_user_id");
  }

  const canonicalMember = await prisma.member.findFirst({
    where: { clerkUserId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, email: true, name: true, agencyId: true },
  });
  if (!canonicalMember) {
    redirect(`/root/users?error=not_found`);
  }
  // Guard against TS narrowing loss after `redirect` (which throws but
  // TS sees as returning `never`).
  if (!canonicalMember) throw new NotFoundError("member vanished");

  // Mint sign-in token + primary email in a single Clerk round-trip
  // window. Failures downgrade to a friendly error redirect.
  let signInUrl: string;
  let expiresAt: Date;
  let primaryEmail: string;
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(clerkUserId);
    const primary =
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ??
      user.emailAddresses[0];
    primaryEmail = primary?.emailAddress ?? canonicalMember.email;

    // `signInTokens.createSignInToken` mints a one-click link that
    // bypasses password auth. TTL clamped at 1h so a stolen inbox
    // doesn't get an eternal backdoor.
    const token = await client.signInTokens.createSignInToken({
      userId: clerkUserId,
      expiresInSeconds: SIGN_IN_TOKEN_TTL_SEC,
    });
    signInUrl = token.url;
    expiresAt = new Date(Date.now() + SIGN_IN_TOKEN_TTL_SEC * 1000);
  } catch (err) {
    console.error("[users:resetPasswordAction] Clerk sign-in token failed", err);
    redirect(`/root/users?error=clerk_failed`);
  }

  const firstName = firstNameFrom(canonicalMember.name, primaryEmail);
  const initiatedBy = ctx.user.name ?? ctx.user.email;

  const sendResult = await sendPasswordResetEmail(primaryEmail, {
    firstName,
    signInUrl,
    initiatedBy,
    expiresAtIso: expiresAt.toISOString(),
  });
  if (!sendResult.ok) {
    console.error("[users:resetPasswordAction] email dispatch failed", sendResult);
    redirect(`/root/users?error=email_failed`);
  }

  // Audit row lands AFTER the external work — we don't want a Clerk /
  // Resend hiccup to leave a "we did X" audit row when in fact nothing
  // shipped. The `after` snapshot captures what actually went out.
  try {
    await withSystemAudit(
      ctx,
      {
        action: SYSTEM_AUDIT_ACTIONS.SUPPORT_RESET_PASSWORD,
        targetMemberId: canonicalMember.id,
        targetEntityType: "clerk_user",
        targetEntityId: clerkUserId,
        note: `Sign-in token emailed to ${primaryEmail}, expires ${expiresAt.toISOString()}`,
      },
      async (_tx, audit) => {
        audit.setAfter({ primaryEmail, expiresAt: expiresAt.toISOString() });
      },
    );
  } catch (err) {
    // The email already went — log but don't fail the flow. The
    // support operator will see the `?ok=` redirect anyway; the audit
    // gap is loggable.
    console.error("[users:resetPasswordAction] audit write failed", err);
  }

  revalidatePath("/root/users");
  redirect(`/root/users?ok=reset_password_sent&email=${encodeURIComponent(primaryEmail)}`);
}

// ============================================================
// Resend welcome
// ============================================================

export async function resendWelcomeAction(formData: FormData): Promise<void> {
  const ctx = await requireSystemAdminContext();
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const clerkUserId = strOrEmpty(formData.get("clerkUserId"));
  const agencyId = strOrEmpty(formData.get("agencyId"));
  if (!clerkUserId || !agencyId) {
    redirect(`/root/users?error=missing_target`);
  }

  const member = await prisma.member.findFirst({
    where: { clerkUserId, agencyId },
    select: {
      id: true,
      email: true,
      name: true,
      agency: { select: { name: true } },
    },
  });
  if (!member) {
    redirect(`/root/users?error=not_found`);
  }
  if (!member) throw new NotFoundError("member vanished");

  const dashboardUrl = resolveAppBase() + "/dashboard";
  const firstName = firstNameFrom(member.name, member.email);

  const sendResult = await sendWelcomeEmail(member.email, {
    firstName,
    agencyName: member.agency.name,
    dashboardUrl,
  });
  if (!sendResult.ok) {
    console.error("[users:resendWelcomeAction] email dispatch failed", sendResult);
    redirect(`/root/users?error=email_failed`);
  }

  try {
    await withSystemAudit(
      ctx,
      {
        action: SYSTEM_AUDIT_ACTIONS.SUPPORT_RESEND_WELCOME,
        targetAgencyId: agencyId,
        targetMemberId: member.id,
        targetEntityType: "clerk_user",
        targetEntityId: clerkUserId,
        note: `Welcome email re-sent to ${member.email} for ${member.agency.name}`,
      },
      async (_tx, audit) => {
        audit.setAfter({ recipient: member.email, agency: member.agency.name });
      },
    );
  } catch (err) {
    console.error("[users:resendWelcomeAction] audit write failed", err);
  }

  revalidatePath("/root/users");
  redirect(`/root/users?ok=welcome_resent&email=${encodeURIComponent(member.email)}`);
}

// ============================================================
// Helpers
// ============================================================

function strOrEmpty(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function firstNameFrom(name: string | null, fallbackEmail: string): string {
  const trimmed = name?.trim();
  if (trimmed && trimmed.length > 0) {
    return trimmed.split(/\s+/)[0]!;
  }
  const emailLocal = fallbackEmail.split("@")[0] ?? "";
  return emailLocal.length > 0 ? emailLocal : "there";
}

function resolveAppBase(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  return raw.replace(/\/$/, "");
}

// Silence a TS complaint about the unused import when Sentry-side
// bundling gets aggressive.
export const _ForbiddenError = ForbiddenError;
