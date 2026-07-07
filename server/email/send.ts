import "server-only";

import { render } from "@react-email/render";
import { FROM_EMAIL, getResendClient } from "./client";
import { AgencyInviteEmail, type AgencyInviteEmailProps } from "./templates/agency-invite";
import {
  ClientRenewalReminderEmail,
  type ClientRenewalReminderEmailProps,
} from "./templates/client-renewal-reminder";
import {
  GenerationCompleteEmail,
  type GenerationCompleteEmailProps,
} from "./templates/generation-complete";
import {
  PortalLinkShareEmail,
  type PortalLinkShareEmailProps,
} from "./templates/portal-link-share";
import { PostPublishedEmail, type PostPublishedEmailProps } from "./templates/post-published";
import {
  OnboardingFinishSetupEmail,
  type OnboardingFinishSetupEmailProps,
} from "./templates/onboarding-finish-setup";
import {
  SuggestionReceivedEmail,
  type SuggestionReceivedEmailProps,
} from "./templates/suggestion-received";
import {
  OnboardingFirstClientEmail,
  type OnboardingFirstClientEmailProps,
} from "./templates/onboarding-first-client";
import { PasswordResetEmail, type PasswordResetEmailProps } from "./templates/password-reset";
import { TrialDay2Email, type TrialDay2EmailProps } from "./templates/trial-day-2";
import { TrialConvertedEmail, type TrialConvertedEmailProps } from "./templates/trial-converted";
import {
  TrialEndingSoonEmail,
  type TrialEndingSoonEmailProps,
} from "./templates/trial-ending-soon";
import { TrialExpiredEmail, type TrialExpiredEmailProps } from "./templates/trial-expired";
import { TrialWelcomeEmail, type TrialWelcomeEmailProps } from "./templates/trial-welcome";
import { WelcomeEmail, type WelcomeEmailProps } from "./templates/welcome";

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

type SendResult = { ok: true; id: string } | { ok: false; reason: string };

async function send(opts: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}): Promise<SendResult> {
  const client = getResendClient();
  if (!client) {
    // Don't fail user flows when email isn't configured — log + carry on.
    console.warn("[email] skipped — RESEND_API_KEY is not set", {
      subject: opts.subject,
      to: opts.to,
    });
    return { ok: false, reason: "RESEND_API_KEY is not set" };
  }
  try {
    const result = await client.emails.send({
      from: FROM_EMAIL,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    if (result.error) {
      console.error("[email] resend rejected", result.error);
      return { ok: false, reason: result.error.message };
    }
    return { ok: true, id: result.data?.id ?? "" };
  } catch (err) {
    console.error("[email] send threw", err);
    return { ok: false, reason: String(err) };
  }
}

// ============================================================
// Welcome
// ============================================================

export async function sendWelcomeEmail(to: string, props: WelcomeEmailProps): Promise<SendResult> {
  const html = await render(WelcomeEmail(props));
  return send({
    to,
    subject: `Welcome to Repodcast, ${props.firstName}`,
    html,
  });
}

/**
 * Phase 3.6.9 — support-initiated one-click sign-in link. Fired only
 * from `/root/users` by ROOT/OPERATOR; every send lands a
 * `SUPPORT_RESET_PASSWORD` audit row.
 */
export async function sendPasswordResetEmail(
  to: string,
  props: PasswordResetEmailProps,
): Promise<SendResult> {
  const html = await render(PasswordResetEmail(props));
  return send({
    to,
    subject: `Sign back in to Repodcast, ${props.firstName}`,
    html,
  });
}

// ============================================================
// Generation complete
// ============================================================

export async function sendGenerationCompleteEmail(
  to: string,
  props: GenerationCompleteEmailProps,
): Promise<SendResult> {
  const html = await render(GenerationCompleteEmail(props));
  const subject =
    props.failedPlatforms.length === 0
      ? `${props.outputCount} outputs ready · ${props.episodeTitle}`
      : `${props.outputCount} ready, ${props.failedPlatforms.length} need attention · ${props.episodeTitle}`;
  return send({ to, subject, html });
}

// ============================================================
// Client-facing "your post is live" notification
// ============================================================

/**
 * Sent to the client's contactEmail after a GeneratedOutput lands in
 * PUBLISHED — regardless of whether the transition came from a user
 * click ("Mark published"), Buffer's sync confirmation, or the MANUAL
 * auto-publish path in the sync cron. Skipped upstream when the client
 * has no contactEmail; this sender assumes the caller already vetted
 * that.
 */
export async function sendPostPublishedEmail(
  to: string,
  props: PostPublishedEmailProps,
): Promise<SendResult> {
  const html = await render(PostPublishedEmail(props));
  return send({
    to,
    subject: `Your ${platformLabel(props.platform)} post is live · ${props.episodeTitle}`,
    html,
  });
}

// Kept in sync with `PLATFORM_LABEL` in `post-published.tsx` — used for
// the email subject line where JSX rendering isn't available.
function platformLabel(p: string): string {
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
      return "show-notes";
    case "BLOG":
      return "blog";
    case "NEWSLETTER":
      return "newsletter";
    default:
      return p;
  }
}

// ============================================================
// Client portal — link share (with optional password)
// ============================================================

/**
 * Delivers the freshly-minted portal URL — and, when the link carries
 * one, the plaintext password — to the client's primary contact. Called
 * fire-and-forget from `mintPortalLinkAction` so a Resend hiccup never
 * blocks the mint itself; the URL is still visible to the operator on
 * the client billing tab for out-of-band delivery.
 */
export async function sendPortalLinkShareEmail(
  to: string,
  props: PortalLinkShareEmailProps,
): Promise<SendResult> {
  const html = await render(PortalLinkShareEmail(props));
  return send({
    to,
    subject: props.password
      ? `${props.agencyName} shared a private link with you`
      : `${props.agencyName} shared your portal link`,
    html,
  });
}

// ============================================================
// Agency invite
// ============================================================

export async function sendAgencyInviteEmail(
  to: string,
  props: AgencyInviteEmailProps,
): Promise<SendResult> {
  const html = await render(AgencyInviteEmail(props));
  return send({
    to,
    subject: `${props.inviterName} invited you to ${props.agencyName} on Repodcast`,
    html,
  });
}

// ============================================================
// Client contract renewal reminder (Phase 2.13.6)
// ============================================================

export async function sendClientRenewalReminderEmail(
  to: string | string[],
  props: ClientRenewalReminderEmailProps,
): Promise<SendResult> {
  const html = await render(ClientRenewalReminderEmail(props));
  const subject =
    props.marker === "7d"
      ? `Renewal in 7 days — ${props.clientName}`
      : `Renewal coming up — ${props.clientName}`;
  return send({ to, subject, html });
}

// ============================================================
// Onboarding drop-off recovery (Phase 2.10)
// ============================================================

export async function sendOnboardingFinishSetupEmail(
  to: string,
  props: OnboardingFinishSetupEmailProps,
): Promise<SendResult> {
  const html = await render(OnboardingFinishSetupEmail(props));
  return send({
    to,
    subject: `Finish setting up ${props.agencyName}`,
    html,
  });
}

export async function sendOnboardingFirstClientEmail(
  to: string,
  props: OnboardingFirstClientEmailProps,
): Promise<SendResult> {
  const html = await render(OnboardingFirstClientEmail(props));
  return send({
    to,
    subject: `Add your first client to ${props.agencyName}`,
    html,
  });
}

// ============================================================
// Trial lifecycle — T-3 nudge (Phase 3.9)
// ============================================================

/**
 * Sent from the Stripe `customer.subscription.trial_will_end` handler.
 * Recipients are all OWNER/ADMIN members of the agency — anyone with
 * card-management authority. Stripe fires this ~72h before the trial
 * ends; we defer to Stripe's timer rather than owning a cron.
 */
export async function sendTrialEndingSoonEmail(
  to: string | string[],
  props: Omit<TrialEndingSoonEmailProps, "billingUrl">,
): Promise<SendResult> {
  const billingUrl = `${APP_BASE_URL}/settings/billing`;
  const html = await render(TrialEndingSoonEmail({ ...props, billingUrl }));
  return send({
    to,
    subject: `${props.agencyName}: your trial ends ${props.trialEndsAt.toDateString()}`,
    html,
  });
}

/**
 * Day 0 — sent immediately from the webhook on `subscription.created` with
 * status `trialing`. Sets expectations for the day-15 charge and links to a
 * quick-start checklist.
 */
export async function sendTrialWelcomeEmail(
  to: string,
  props: Omit<TrialWelcomeEmailProps, "dashboardUrl">,
): Promise<SendResult> {
  const dashboardUrl = `${APP_BASE_URL}/dashboard`;
  const html = await render(TrialWelcomeEmail({ ...props, dashboardUrl }));
  return send({
    to,
    subject: `${props.agencyName}: your ${props.plan} trial is live`,
    html,
  });
}

/**
 * Day 15 conversion success — sent from the webhook on the `trialing →
 * active` transition. Also serves as an ambient "your first invoice is
 * ready" nudge.
 */
export async function sendTrialConvertedEmail(
  to: string | string[],
  props: Omit<TrialConvertedEmailProps, "billingUrl">,
): Promise<SendResult> {
  const billingUrl = `${APP_BASE_URL}/settings/billing`;
  const html = await render(TrialConvertedEmail({ ...props, billingUrl }));
  return send({
    to,
    subject: `${props.agencyName}: your trial converted to ${props.plan}`,
    html,
  });
}

/**
 * Trial ended without a successful charge — sent from the webhook on
 * `subscription.deleted` when we mark the agency EXPIRED (see
 * `handleSubscriptionDeleted`). Skipped for user-initiated cancellations.
 */
export async function sendTrialExpiredEmail(
  to: string | string[],
  props: Omit<TrialExpiredEmailProps, "billingUrl">,
): Promise<SendResult> {
  const billingUrl = `${APP_BASE_URL}/settings/billing`;
  const html = await render(TrialExpiredEmail({ ...props, billingUrl }));
  return send({
    to,
    subject: `${props.agencyName}: your trial ended`,
    html,
  });
}

/**
 * Day-2 mid-trial portal-preview nudge. Fired by the `check-trial-nudges`
 * cron. The dedupe row in `TrialNudgeSent` guarantees exactly-once delivery
 * per (agency, "day_2") across cron retries and window slippage.
 */
export async function sendTrialDay2Email(
  to: string,
  props: Omit<TrialDay2EmailProps, "clientsUrl">,
): Promise<SendResult> {
  const clientsUrl = `${APP_BASE_URL}/clients`;
  const html = await render(TrialDay2Email({ ...props, clientsUrl }));
  return send({
    to,
    subject: `${props.agencyName}: here's what your client sees`,
    html,
  });
}

// ============================================================
// In-app feedback / suggestion notification
// ============================================================

const SUGGESTION_SUBJECT_PREFIX: Record<SuggestionReceivedEmailProps["type"], string> = {
  BUG: "[Bug]",
  FEATURE_REQUEST: "[Feature]",
  IMPROVEMENT: "[Improvement]",
  QUESTION: "[Question]",
  OTHER: "[Feedback]",
};

/**
 * Sent to the feedback inbox (`CONTACT_EMAILS.feedback`) when a user
 * submits via the dashboard Feedback button. Fire-and-forget from the
 * server action — the durable inbox is the `Suggestion` row in Postgres.
 */
export async function sendSuggestionReceivedEmail(
  to: string | string[],
  props: Omit<SuggestionReceivedEmailProps, "triageUrl">,
): Promise<SendResult> {
  const triageUrl = `${APP_BASE_URL}/root/feedback`;
  const html = await render(SuggestionReceivedEmail({ ...props, triageUrl }));
  return send({
    to,
    subject: `${SUGGESTION_SUBJECT_PREFIX[props.type]} ${props.title}`,
    html,
  });
}
