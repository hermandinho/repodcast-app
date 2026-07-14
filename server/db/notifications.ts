import "server-only";

import { MemberRole, NotificationKind, type Notification, type Platform } from "@prisma/client";
import { requireReadRole, type TenantContext } from "@/server/auth/tenant";
import { NotFoundError } from "@/server/auth/errors";
import { getResendClient, FROM_EMAIL } from "@/server/email/client";
import { sendPortalLinkShareEmail, sendPostPublishedEmail } from "@/server/email/send";
import { prisma } from "./client";

const READ_ROLES = [
  MemberRole.OWNER,
  MemberRole.ADMIN,
  MemberRole.EDITOR,
  MemberRole.REVIEWER,
] as const;

/** Notification recipients on the agency side — the roles that should
 *  hear about workflow events. Editors don't get notified about their
 *  own review requests; reviewers don't get flagged because the
 *  "request review" path is already an EDITOR-only inbox for the
 *  approver-side team. */
const RECIPIENT_ROLES = [MemberRole.OWNER, MemberRole.ADMIN] as const;

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

// ============================================================
// Client-facing "your post is live" notification
// ============================================================

/**
 * Fires an email to the *client's* contactEmail after a GeneratedOutput
 * lands in PUBLISHED. Callable from every publish path:
 *   1. `markOutputPublished` (user hits "Mark published" in the drawer)
 *   2. `sync-scheduled-outputs` BUFFER branch (Buffer reports `sent`)
 *   3. `sync-scheduled-outputs` MANUAL branch (auto-publish after
 *      scheduledFor passes on an agency with the flag on)
 *
 * No agency-side Notification row — this is a client-inbox notification,
 * not a workspace inbox item, so we skip the fanout table entirely.
 * Skipped cleanly when the client has no contactEmail (agencies aren't
 * required to fill one in); fire-and-forget otherwise so a Resend hiccup
 * never blocks the status flip that triggered it.
 */
export async function notifyClientPostPublished(outputId: string): Promise<void> {
  try {
    const row = await prisma.generatedOutput.findUnique({
      where: { id: outputId },
      select: {
        publishedAt: true,
        externalPostUrl: true,
        platform: true,
        episode: {
          select: {
            title: true,
            show: {
              select: {
                name: true,
                client: {
                  select: {
                    contactEmail: true,
                    contactName: true,
                    agency: {
                      select: {
                        name: true,
                        brandLogoUrl: true,
                        brandAccentColor: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const contactEmail = row?.episode.show.client.contactEmail;
    if (!row || !contactEmail) return;

    const client = row.episode.show.client;
    const result = await sendPostPublishedEmail(contactEmail, {
      contactName: (client.contactName ?? "").trim(),
      agencyName: client.agency.name,
      brandLogoUrl: client.agency.brandLogoUrl,
      brandAccentColor: client.agency.brandAccentColor,
      episodeTitle: row.episode.title,
      showName: row.episode.show.name,
      platform: row.platform,
      externalPostUrl: row.externalPostUrl,
      // Publish time may lag the write — Buffer's `sent_at` gets
      // persisted in the same transaction, but the cron can also flip
      // a MANUAL row without a discrete publishedAt in edge cases.
      // Fall back to `now` so the email always shows a timestamp.
      publishedAt: row.publishedAt ?? new Date(),
    });
    if (!result.ok) {
      console.error("[notify-client-post-published] send failed", {
        outputId,
        reason: result.reason,
      });
    }
  } catch (err) {
    // Notification failures must never bubble — the caller has
    // already committed the PUBLISHED status flip and we can't undo it
    // just because an email couldn't reach Resend.
    console.error("[notify-client-post-published] threw", { outputId, err });
  }
}

// ============================================================
// Client-facing portal-link share (password rollout)
// ============================================================

/**
 * Delivers the freshly-minted portal URL to the client's contactEmail,
 * including the plaintext password when the link carries one. Called
 * fire-and-forget from `mintPortalLinkAction` so a Resend hiccup never
 * blocks the mint; the operator can always fall back to copying the URL
 * off the billing tab.
 *
 * No-op cleanly when the client has no contactEmail — agencies aren't
 * required to fill one in, and a missing address here is expected, not
 * an error. The mint form already tells the operator the email will
 * only go out when a contact is on file.
 */
export async function notifyClientPortalLinkShared(linkId: string): Promise<void> {
  try {
    const row = await prisma.clientPortalLink.findUnique({
      where: { id: linkId },
      select: {
        token: true,
        password: true,
        expiresAt: true,
        client: {
          select: {
            contactEmail: true,
            contactName: true,
            agency: {
              select: {
                name: true,
                brandLogoUrl: true,
                brandAccentColor: true,
              },
            },
          },
        },
      },
    });
    const contactEmail = row?.client.contactEmail;
    if (!row || !contactEmail) return;

    const portalUrl = `${APP_BASE_URL}/portal/${row.token}`;
    const result = await sendPortalLinkShareEmail(contactEmail, {
      contactName: (row.client.contactName ?? "").trim(),
      agencyName: row.client.agency.name,
      brandLogoUrl: row.client.agency.brandLogoUrl,
      brandAccentColor: row.client.agency.brandAccentColor,
      portalUrl,
      password: row.password,
      expiresAt: row.expiresAt,
    });
    if (!result.ok) {
      console.error("[notify-client-portal-link-shared] send failed", {
        linkId,
        reason: result.reason,
      });
    }
  } catch (err) {
    console.error("[notify-client-portal-link-shared] threw", { linkId, err });
  }
}

// ============================================================
// Writes — event → notification fan-out
// ============================================================

type FanoutInput = {
  agencyId: string;
  clientId: string;
  outputId: string;
  episodeId: string;
  episodeTitle: string;
  platform: Platform;
  /** Present when the event was triggered inside the agency (editor
   *  requested review); null for portal-side actions. */
  actorMemberId?: string | null;
  actorName?: string | null;
};

export async function notifyReviewRequested(
  input: FanoutInput & { note?: string | null },
): Promise<void> {
  const body = input.actorName
    ? `${input.actorName} requested review on ${input.platform.toLowerCase()} for "${input.episodeTitle}"`
    : `Review requested on ${input.platform.toLowerCase()} for "${input.episodeTitle}"`;
  await fanout({
    ...input,
    kind: NotificationKind.REVIEW_REQUESTED,
    body,
    subject: `Review requested — ${input.episodeTitle}`,
    emailIntro: input.actorName
      ? `${input.actorName} asked for a review on a ${humanPlatform(input.platform)} draft for “${input.episodeTitle}”.`
      : `A ${humanPlatform(input.platform)} draft for “${input.episodeTitle}” is waiting on your review.`,
    emailNote: input.note ?? null,
  });
}

export async function notifyClientApproved(input: FanoutInput): Promise<void> {
  const body = `Client approved the ${input.platform.toLowerCase()} post for "${input.episodeTitle}"`;
  await fanout({
    ...input,
    kind: NotificationKind.CLIENT_APPROVED,
    body,
    subject: `Client approved — ${input.episodeTitle}`,
    emailIntro: `Your client just approved the ${humanPlatform(input.platform)} post for “${input.episodeTitle}”. You can schedule it now.`,
    emailNote: null,
  });
}

export async function notifyClientRevisionRequested(
  input: FanoutInput & { note?: string | null },
): Promise<void> {
  const body = `Client requested a revision on ${input.platform.toLowerCase()} for "${input.episodeTitle}"`;
  await fanout({
    ...input,
    kind: NotificationKind.CLIENT_REVISION_REQUESTED,
    body,
    subject: `Client asked for changes — ${input.episodeTitle}`,
    emailIntro: `Your client asked for changes on the ${humanPlatform(input.platform)} draft for “${input.episodeTitle}”.`,
    emailNote: input.note ?? null,
  });
}

// ============================================================
// Reads — dashboard bell + inbox
// ============================================================

export type NotificationForMember = Notification & {
  actor: { id: string; name: string | null; email: string } | null;
  episode: { id: string; title: string } | null;
};

export async function listNotificationsForCurrentMember(
  ctx: TenantContext,
  memberId: string,
  limit = 30,
): Promise<NotificationForMember[]> {
  requireReadRole(ctx, READ_ROLES);
  return prisma.notification.findMany({
    where: { memberId, agencyId: ctx.agencyId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      actor: { select: { id: true, name: true, email: true } },
      episode: { select: { id: true, title: true } },
    },
  });
}

export async function countUnreadForCurrentMember(
  ctx: TenantContext,
  memberId: string,
): Promise<number> {
  requireReadRole(ctx, READ_ROLES);
  return prisma.notification.count({
    where: { memberId, agencyId: ctx.agencyId, readAt: null },
  });
}

export async function markNotificationRead(
  ctx: TenantContext,
  memberId: string,
  notificationId: string,
): Promise<void> {
  requireReadRole(ctx, READ_ROLES);
  const row = await prisma.notification.findFirst({
    where: { id: notificationId, memberId, agencyId: ctx.agencyId },
    select: { id: true },
  });
  if (!row) throw new NotFoundError(`Notification ${notificationId} not found`);
  await prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(
  ctx: TenantContext,
  memberId: string,
): Promise<number> {
  requireReadRole(ctx, READ_ROLES);
  const result = await prisma.notification.updateMany({
    where: { memberId, agencyId: ctx.agencyId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

// ============================================================
// Internals
// ============================================================

type FanoutBody = FanoutInput & {
  kind: NotificationKind;
  body: string;
  subject: string;
  emailIntro: string;
  emailNote: string | null;
};

async function fanout(input: FanoutBody): Promise<void> {
  const recipients = await prisma.member.findMany({
    where: {
      agencyId: input.agencyId,
      role: { in: [...RECIPIENT_ROLES] },
    },
    select: { id: true, email: true },
  });

  if (recipients.length > 0) {
    await prisma.notification.createMany({
      data: recipients.map((r) => ({
        agencyId: input.agencyId,
        memberId: r.id,
        kind: input.kind,
        outputId: input.outputId,
        episodeId: input.episodeId,
        actorMemberId: input.actorMemberId ?? null,
        body: input.body,
      })),
    });
  }

  // Email fan-out — union of recipient member emails and the client's
  // configured `notificationEmails`, de-duplicated. Best-effort: a Resend
  // failure never blocks the state transition that spawned the event.
  const clientExtras = await prisma.client.findUnique({
    where: { id: input.clientId },
    select: { notificationEmails: true },
  });
  const emailSet = new Set<string>();
  for (const r of recipients) emailSet.add(r.email);
  for (const e of clientExtras?.notificationEmails ?? []) emailSet.add(e);
  const emails = [...emailSet];
  if (emails.length === 0) return;

  const episodeUrl = `${APP_BASE_URL}/episodes/${input.episodeId}`;
  const html = renderEmail({
    subject: input.subject,
    intro: input.emailIntro,
    note: input.emailNote,
    ctaHref: episodeUrl,
    ctaLabel: "Open in Repodcast",
  });

  const client = getResendClient();
  if (!client) {
    console.warn("[notifications] RESEND_API_KEY not set — email skipped", {
      subject: input.subject,
      count: emails.length,
    });
    return;
  }
  try {
    await client.emails.send({
      from: FROM_EMAIL,
      to: emails,
      subject: input.subject,
      html,
    });
  } catch (err) {
    console.error("[notifications] resend send failed", err);
  }
}

function humanPlatform(p: Platform): string {
  switch (p) {
    case "TWITTER":
      return "X / Twitter";
    case "LINKEDIN":
      return "LinkedIn";
    case "INSTAGRAM":
      return "Instagram";
    case "TIKTOK":
      return "TikTok";
    case "SHOW_NOTES":
      return "show notes";
    case "BLOG":
      return "blog";
    case "NEWSLETTER":
      return "newsletter";
  }
}

function renderEmail(input: {
  subject: string;
  intro: string;
  note: string | null;
  ctaHref: string;
  ctaLabel: string;
}): string {
  const noteBlock = input.note
    ? `<p style="margin:16px 0 0;padding:12px 14px;background:#F4F6FA;border-radius:8px;font-size:14px;color:#3A4152;">
         <strong style="display:block;font-size:12px;color:#6B7280;margin-bottom:4px;">Note</strong>
         ${escapeHtml(input.note)}
       </p>`
    : "";
  return `<!doctype html>
<html>
  <body style="margin:0;background:#F7F8FB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1A2A4A;">
    <div style="max-width:560px;margin:32px auto;padding:32px 28px;background:#FFFFFF;border-radius:12px;border:1px solid #E4E8F0;">
      <h1 style="margin:0 0 8px;font-size:20px;font-weight:600;color:#1A2A4A;">${escapeHtml(input.subject)}</h1>
      <p style="margin:0;font-size:15px;line-height:1.55;color:#3A4152;">${escapeHtml(input.intro)}</p>
      ${noteBlock}
      <p style="margin:24px 0 0;">
        <a href="${input.ctaHref}" style="display:inline-block;padding:11px 20px;background:#1A2A4A;color:#FFFFFF;text-decoration:none;border-radius:9px;font-weight:600;font-size:14px;">${escapeHtml(input.ctaLabel)}</a>
      </p>
    </div>
  </body>
</html>`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
