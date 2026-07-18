import type { ReactElement } from "react";
import { BillingCadence, Plan } from "@prisma/client";

import { AgencyInviteEmail } from "@/server/email/templates/agency-invite";
import { ClientRenewalReminderEmail } from "@/server/email/templates/client-renewal-reminder";
import { GenerationCompleteEmail } from "@/server/email/templates/generation-complete";
import { OnboardingFinishSetupEmail } from "@/server/email/templates/onboarding-finish-setup";
import { OnboardingFirstClientEmail } from "@/server/email/templates/onboarding-first-client";
import { PasswordResetEmail } from "@/server/email/templates/password-reset";
import { PortalLinkShareEmail } from "@/server/email/templates/portal-link-share";
import { PostPublishedEmail } from "@/server/email/templates/post-published";
import { SupportOnboardingCompleteEmail } from "@/server/email/templates/support-onboarding-complete";
import { SupportPlanChangedEmail } from "@/server/email/templates/support-plan-changed";
import { SupportUserSignupEmail } from "@/server/email/templates/support-user-signup";
import { TrialConvertedEmail } from "@/server/email/templates/trial-converted";
import { TrialDay2Email } from "@/server/email/templates/trial-day-2";
import { TrialEndingSoonEmail } from "@/server/email/templates/trial-ending-soon";
import { TrialExpiredEmail } from "@/server/email/templates/trial-expired";
import { TrialWelcomeEmail } from "@/server/email/templates/trial-welcome";
import { WelcomeEmail } from "@/server/email/templates/welcome";

/**
 * /root/emails — static preview data + metadata for every transactional
 * email the app sends. The list drives both the index and detail pages,
 * so adding a template here surfaces it everywhere.
 *
 * Each entry carries:
 *  - the React Email `element` (already instantiated with fixture props)
 *  - the `subject` line the sender emits (kept in sync with server/email/send.ts)
 *  - trigger + recipient + purpose metadata for the operator-facing side pane
 *
 * Fixtures deliberately use recognizable dummy values ("Acme Podcast Group",
 * "Sarah") so the preview never gets confused with a real production send.
 */

const PREVIEW_ORIGIN = "https://repodcastapp.com";
const DEMO_AGENCY = "Acme Podcast Group";
const DEMO_CLIENT = "Blue Ocean Studios";
const DEMO_FIRST_NAME = "Sarah";
const DEMO_INVITER = "Marcus Chen";

const TRIAL_END = new Date("2026-07-18T09:00:00Z");
const RENEWAL_DATE_LABEL = "2026-08-14";

export type EmailJourneyKey = "trial" | "onboarding" | "product" | "team" | "support" | "internal";

export type EmailTriggerType = "webhook" | "cron" | "manual";

export type EmailEntry = {
  slug: string;
  name: string;
  journey: EmailJourneyKey;
  subject: string;
  /** One-line purpose in plain English. */
  purpose: string;
  /** Longer "why does this email exist" — shown on the detail page. */
  rationale: string;
  trigger: {
    type: EmailTriggerType;
    /** Human phrasing: "Stripe webhook — subscription.created", "Daily cron 14:00 UTC", etc. */
    label: string;
    /** file:line where the send is invoked. */
    source: string;
  };
  recipient: {
    label: string;
    /** How the recipient address is resolved. */
    lookup: string;
  };
  cadence: string;
  /** Sender function name from server/email/send.ts, for cross-reference. */
  senderFn: string;
  /** Rendered React element carrying fixture props. */
  element: ReactElement;
};

export const EMAIL_JOURNEYS: Record<
  EmailJourneyKey,
  { title: string; blurb: string; order: number }
> = {
  trial: {
    order: 1,
    title: "Trial lifecycle",
    blurb:
      "Day 0 → Day 15. Sets expectations at signup, nudges the aha moment, warns before the charge, then confirms conversion or a failed capture.",
  },
  onboarding: {
    order: 2,
    title: "Onboarding recovery",
    blurb:
      "Escalating nudges for signups that stalled before they produced anything. Each fires exactly once per agency.",
  },
  product: {
    order: 3,
    title: "Product events",
    blurb:
      "Fired by activity inside the workspace — a pipeline finished, a client renewal is coming up.",
  },
  team: {
    order: 4,
    title: "Team & access",
    blurb: "Invitations and access-flow emails inside the agency workspace.",
  },
  support: {
    order: 5,
    title: "Support-initiated",
    blurb:
      "Manual sends triggered by a ROOT/OPERATOR from the /root admin panel. Every send lands an audit row.",
  },
  internal: {
    order: 6,
    title: "Internal notifications",
    blurb:
      "Team-facing pings routed to CONTACT_EMAILS.support so ops notices signups, completed onboardings, and plan changes without polling the DB.",
  },
};

export const EMAILS: readonly EmailEntry[] = [
  // ------------------------------------------------------------
  // Trial lifecycle
  // ------------------------------------------------------------
  {
    slug: "trial-welcome",
    name: "Trial welcome (Day 0)",
    journey: "trial",
    subject: `${DEMO_AGENCY}: your ${Plan.STUDIO} trial is live`,
    purpose:
      "Welcomes a fresh trial signup and sets expectations for the day-8 recurring charge (the $1 activation already landed at Checkout).",
    rationale:
      "Fires immediately when Stripe reports the subscription as `trialing`. Distinct from the paid Welcome email because the trial framing (activation fee already charged, recurring plan charge in 7 days, cancel any time) has to be baked in from the very first touch — that's what keeps trial-abandoners from feeling ambushed on day 8.",
    trigger: {
      type: "webhook",
      label: "Stripe webhook · subscription.created (status=trialing)",
      source: "app/api/webhooks/stripe/route.ts:188",
    },
    recipient: {
      label: "Agency OWNER (founding member)",
      lookup: "First OWNER by createdAt, excluding synthetic @clerk.local addresses.",
    },
    cadence: "One-shot, at trial start.",
    senderFn: "sendTrialWelcomeEmail",
    element: TrialWelcomeEmail({
      firstName: DEMO_FIRST_NAME,
      agencyName: DEMO_AGENCY,
      plan: Plan.STUDIO,
      trialEndsAt: TRIAL_END,
      dashboardUrl: `${PREVIEW_ORIGIN}/dashboard`,
    }),
  },
  {
    slug: "trial-day-2",
    name: "Trial Day 2 · portal preview",
    journey: "trial",
    subject: `${DEMO_AGENCY}: here's what your client sees`,
    purpose:
      "Mid-trial nudge to push the client-portal aha moment — the leading indicator for conversion.",
    rationale:
      "The `check-trial-nudges` Inngest cron fires this at ~day 2 of the trial window. Trialists who see their client's read-only portal convert at ~2× the rate of those who don't — this email is the whole reason for that cron.",
    trigger: {
      type: "cron",
      label: "Inngest cron · check-trial-nudges (daily 15:00 UTC)",
      source: "inngest/functions/check-trial-nudges.ts:47",
    },
    recipient: {
      label: "Agency OWNER (founding member)",
      lookup: "First OWNER by createdAt, excluding synthetic @clerk.local addresses.",
    },
    cadence: "One-shot at ~48h post-signup. Dedupe row in TrialNudgeSent guarantees exactly-once.",
    senderFn: "sendTrialDay2Email",
    element: TrialDay2Email({
      firstName: DEMO_FIRST_NAME,
      agencyName: DEMO_AGENCY,
      outputCount: 7,
      clientsUrl: `${PREVIEW_ORIGIN}/clients`,
    }),
  },
  {
    slug: "trial-ending-soon",
    name: "Trial ending soon (T-3d)",
    journey: "trial",
    subject: `${DEMO_AGENCY}: your trial ends ${TRIAL_END.toDateString()}`,
    purpose: "Final heads-up before the trial converts to a paid charge.",
    rationale:
      "Fires from Stripe's `trial_will_end` event (~72h before end), so timing is consistent regardless of when the trial started. Recipients are card-management authorities (OWNER + ADMIN); we defer to Stripe's clock rather than owning a cron for this.",
    trigger: {
      type: "webhook",
      label: "Stripe webhook · customer.subscription.trial_will_end",
      source: "app/api/webhooks/stripe/route.ts:273",
    },
    recipient: {
      label: "All OWNER + ADMIN members",
      lookup: "Member.role IN (OWNER, ADMIN) for the agency, resolved to primary emails.",
    },
    cadence: "One-shot, ~72h before trial end.",
    senderFn: "sendTrialEndingSoonEmail",
    element: TrialEndingSoonEmail({
      agencyName: DEMO_AGENCY,
      plan: Plan.STUDIO,
      trialEndsAt: TRIAL_END,
      billingUrl: `${PREVIEW_ORIGIN}/settings/billing`,
    }),
  },
  {
    slug: "trial-converted",
    name: "Trial converted (Day 15)",
    journey: "trial",
    subject: `${DEMO_AGENCY}: your trial converted to ${Plan.STUDIO}`,
    purpose: "Confirms the first successful charge and points to the first invoice.",
    rationale:
      "Sent on the `trialing → active` transition. Doubles as a `first invoice is ready` nudge; marketing also wants the moment for cohort tracking.",
    trigger: {
      type: "webhook",
      label: "Stripe webhook · subscription.updated (trialing → active)",
      source: "app/api/webhooks/stripe/route.ts:194",
    },
    recipient: {
      label: "All OWNER + ADMIN members",
      lookup: "Member.role IN (OWNER, ADMIN) for the agency, resolved to primary emails.",
    },
    cadence: "One-shot, on successful first charge.",
    senderFn: "sendTrialConvertedEmail",
    element: TrialConvertedEmail({
      agencyName: DEMO_AGENCY,
      plan: Plan.STUDIO,
      billingUrl: `${PREVIEW_ORIGIN}/settings/billing`,
    }),
  },
  {
    slug: "trial-expired",
    name: "Trial ended (failed charge)",
    journey: "trial",
    subject: `${DEMO_AGENCY}: your trial ended`,
    purpose:
      "Notifies that Stripe couldn't complete the first invoice — the workspace is now capped at SOLO limits.",
    rationale:
      "Only fires when `subscription.deleted` carries a cancellation reason that is NOT `cancellation_requested` (i.e. failed payment). User-initiated trial cancellations get no email — we don't want to guilt-trip active cancellations.",
    trigger: {
      type: "webhook",
      label: "Stripe webhook · subscription.deleted (non-user cancel)",
      source: "app/api/webhooks/stripe/route.ts:333",
    },
    recipient: {
      label: "All OWNER + ADMIN members",
      lookup: "Member.role IN (OWNER, ADMIN) for the agency, resolved to primary emails.",
    },
    cadence: "One-shot, on failed first-charge only.",
    senderFn: "sendTrialExpiredEmail",
    element: TrialExpiredEmail({
      agencyName: DEMO_AGENCY,
      billingUrl: `${PREVIEW_ORIGIN}/settings/billing`,
    }),
  },

  // ------------------------------------------------------------
  // Onboarding recovery
  // ------------------------------------------------------------
  {
    slug: "onboarding-finish-setup",
    name: "Onboarding · finish setup (24h)",
    journey: "onboarding",
    subject: `Finish setting up ${DEMO_AGENCY}`,
    purpose: "Recovers signups that stalled at the plan-selection step.",
    rationale:
      "The hourly `check-nudges` cron targets agencies created ~24h ago whose Stripe subscription is still NULL. Deep-links back into `/onboarding`, where the resume gate routes to the exact substep they abandoned on.",
    trigger: {
      type: "cron",
      label: "Inngest cron · onboarding/check-nudges (hourly)",
      source: "inngest/functions/check-onboarding-nudges.ts:61",
    },
    recipient: {
      label: "Agency OWNER (founding member)",
      lookup: "First OWNER by createdAt, excluding synthetic @clerk.local addresses.",
    },
    cadence: "One-shot at ~24h post-signup. Dedupe row prevents re-send.",
    senderFn: "sendOnboardingFinishSetupEmail",
    element: OnboardingFinishSetupEmail({
      firstName: DEMO_FIRST_NAME,
      agencyName: DEMO_AGENCY,
      resumeUrl: `${PREVIEW_ORIGIN}/onboarding`,
    }),
  },
  {
    slug: "onboarding-first-client",
    name: "Onboarding · add first client (72h)",
    journey: "onboarding",
    subject: `Add your first client to ${DEMO_AGENCY}`,
    purpose:
      "Recovers signups that paid but haven't onboarded a client yet — the second common stall point.",
    rationale:
      "Fires against agencies at ~72h with a live subscription and zero Client rows. Escalates from the 24h nudge; both fire on independent markers, dedupe rows make sure neither ever double-sends.",
    trigger: {
      type: "cron",
      label: "Inngest cron · onboarding/check-nudges (hourly)",
      source: "inngest/functions/check-onboarding-nudges.ts:144",
    },
    recipient: {
      label: "Agency OWNER (founding member)",
      lookup: "First OWNER by createdAt, excluding synthetic @clerk.local addresses.",
    },
    cadence: "One-shot at ~72h post-signup. Dedupe row prevents re-send.",
    senderFn: "sendOnboardingFirstClientEmail",
    element: OnboardingFirstClientEmail({
      firstName: DEMO_FIRST_NAME,
      agencyName: DEMO_AGENCY,
      newClientUrl: `${PREVIEW_ORIGIN}/clients`,
    }),
  },

  // ------------------------------------------------------------
  // Product events
  // ------------------------------------------------------------
  {
    slug: "generation-complete",
    name: "Generation complete",
    journey: "product",
    subject: `7 outputs ready · How to price a podcast partnership`,
    purpose: "Tells the team a pipeline finished and outputs are ready to review.",
    rationale:
      "Fires from the episode-generation Inngest job after every platform output has either resolved or failed. Subject line adapts to whether any platforms need a retry, so the inbox surfaces urgency without opening.",
    trigger: {
      type: "webhook",
      label: "Inngest job · generate-episode.send-completion-email",
      source: "inngest/functions/generate-episode.ts:368",
    },
    recipient: {
      label: "All OWNER + ADMIN members",
      lookup:
        "Member.role IN (OWNER, ADMIN) for the episode's agency. Editor-only members are excluded.",
    },
    cadence: "Once per episode generation, on completion.",
    senderFn: "sendGenerationCompleteEmail",
    element: GenerationCompleteEmail({
      recipientName: DEMO_FIRST_NAME,
      episodeTitle: "How to price a podcast partnership",
      clientName: DEMO_CLIENT,
      outputCount: 7,
      failedPlatforms: [],
      episodeUrl: `${PREVIEW_ORIGIN}/episodes/ep_2Kq9L`,
    }),
  },
  {
    slug: "post-published",
    name: "Client post published",
    journey: "product",
    subject: `Your LinkedIn post is live · How to price a podcast partnership`,
    purpose:
      "Notifies the client's contact that a post drafted for them has gone live — either after Buffer confirms delivery or after the agency marks it published manually.",
    rationale:
      "The only email in the app that lands in the *client's* inbox rather than an agency member's. Fires from every path that flips a GeneratedOutput to PUBLISHED: `markOutputPublished` (user click), Buffer sync confirm, and MANUAL auto-publish after `scheduledFor` passes. White-labeled with the agency's brand logo + accent color so the client experiences it as coming from their agency, not from Repodcast.",
    trigger: {
      type: "webhook",
      label: "Direct call from every publish path",
      source: "server/db/notifications.ts:notifyClientPostPublished",
    },
    recipient: {
      label: "Client's primary contact",
      lookup: "Client.contactEmail (email-only; no-op when unset).",
    },
    cadence: "Up to once per output — one email per platform per publish event.",
    senderFn: "sendPostPublishedEmail",
    element: PostPublishedEmail({
      contactName: "Alex",
      agencyName: DEMO_AGENCY,
      brandLogoUrl: null,
      brandAccentColor: null,
      episodeTitle: "How to price a podcast partnership",
      showName: DEMO_CLIENT,
      platform: "LINKEDIN",
      externalPostUrl:
        "https://www.linkedin.com/posts/blue-ocean-studios_partnership-pricing-activity-1234567890",
      publishedAt: new Date("2026-07-05T14:30:00Z"),
    }),
  },
  {
    slug: "portal-link-share",
    name: "Client portal link share",
    journey: "product",
    subject: `${DEMO_AGENCY} shared a private link with you`,
    purpose:
      "Delivers a freshly-minted portal URL — plus the shared password when the operator set one — to the client's primary contact.",
    rationale:
      "Fires from the mint action on the client billing tab. Client-inbox delivery so the operator doesn't have to hand-craft an email; auto-skip when the client has no contactEmail, since the URL is still visible to the operator on the billing tab for out-of-band sharing. Password (when set) is surfaced plaintext — this email is the only sanctioned surface for it outside the mint dialog.",
    trigger: {
      type: "manual",
      label: "Client billing tab · Mint new link",
      source: "app/(dashboard)/clients/[key]/billing/portal-actions.ts:mintPortalLinkAction",
    },
    recipient: {
      label: "Client's primary contact",
      lookup: "Client.contactEmail (email-only; no-op when unset).",
    },
    cadence: "One per successful mint.",
    senderFn: "sendPortalLinkShareEmail",
    element: PortalLinkShareEmail({
      contactName: "Alex",
      agencyName: DEMO_AGENCY,
      brandLogoUrl: null,
      brandAccentColor: null,
      portalUrl: `${PREVIEW_ORIGIN}/portal/prtl_2Kq9L3mNpXr8`,
      password: "starlight-27",
      expiresAt: new Date("2026-08-04T09:00:00Z"),
    }),
  },
  {
    slug: "client-renewal-reminder",
    name: "Client contract renewal reminder",
    journey: "product",
    subject: `Renewal in 7 days — ${DEMO_CLIENT}`,
    purpose:
      "Alerts the agency ahead of a client contract renewal so they can pull cost-to-serve before the conversation.",
    rationale:
      "Daily `billing/check-renewals` cron fires this at 30-day and 7-day pre-renewal markers. Gated per-agency by the `renewalRemindersEnabled` flag (users can opt out from Settings → Agency).",
    trigger: {
      type: "cron",
      label: "Inngest cron · billing/check-renewals (daily 14:00 UTC)",
      source: "inngest/functions/check-renewals.ts:58",
    },
    recipient: {
      label: "All OWNER + ADMIN members",
      lookup:
        "Member.role IN (OWNER, ADMIN) for the client's agency, gated by Agency.renewalRemindersEnabled.",
    },
    cadence: "Up to twice per contract: at T-30d and T-7d.",
    senderFn: "sendClientRenewalReminderEmail",
    element: ClientRenewalReminderEmail({
      agencyName: DEMO_AGENCY,
      clientName: DEMO_CLIENT,
      marker: "7d",
      daysToRenewal: 7,
      renewalDateLabel: RENEWAL_DATE_LABEL,
      billingUrl: `${PREVIEW_ORIGIN}/clients/blue-ocean-studios/billing`,
    }),
  },

  // ------------------------------------------------------------
  // Team & access
  // ------------------------------------------------------------
  {
    slug: "agency-invite",
    name: "Agency invite",
    journey: "team",
    subject: `${DEMO_INVITER} invited you to ${DEMO_AGENCY} on Repodcast`,
    purpose: "Invites a new team member to an existing agency workspace.",
    rationale:
      "Kicked off when an OWNER/ADMIN uses the Team settings invite form. Carries a signed link that expires after 14 days — matched by the `MemberInvite.expiresAt` row on the DB side, so a re-send just refreshes the same row.",
    trigger: {
      type: "manual",
      label: "Team invite action · Settings → Team",
      source: "app/(dashboard)/settings/team/actions.ts:93",
    },
    recipient: {
      label: "Invited email address (any inbox)",
      lookup: "Address entered on the invite form.",
    },
    cadence: "One per invite. Re-send from the settings screen re-uses the same token.",
    senderFn: "sendAgencyInviteEmail",
    element: AgencyInviteEmail({
      inviterName: DEMO_INVITER,
      agencyName: DEMO_AGENCY,
      roleLabel: "Editor",
      acceptUrl: `${PREVIEW_ORIGIN}/invite/inv_9Wq2P4kR7`,
      expiresIn: "14 days",
    }),
  },

  // ------------------------------------------------------------
  // Support-initiated
  // ------------------------------------------------------------
  {
    slug: "welcome",
    name: "Welcome (support re-send)",
    journey: "support",
    subject: `Welcome to Repodcast, ${DEMO_FIRST_NAME}`,
    purpose:
      "Re-sends the paid-signup welcome message. Manual send only — the automated flow is the trial-welcome email.",
    rationale:
      "Fired from the /root/users panel by a ROOT/OPERATOR (`Re-send welcome`). Kept in the codebase because the paid, non-trial path still needs an onboarding message; support uses it for founders who lost the original.",
    trigger: {
      type: "manual",
      label: "Support action · /root/users → Re-send welcome",
      source: "app/(root)/root/users/actions.ts:165",
    },
    recipient: {
      label: "Any single user",
      lookup: "Clerk primary email on the target user, chosen from the /root/users list.",
    },
    cadence: "On demand — every send lands a SUPPORT_RESEND_WELCOME audit row.",
    senderFn: "sendWelcomeEmail",
    element: WelcomeEmail({
      firstName: DEMO_FIRST_NAME,
      agencyName: DEMO_AGENCY,
      dashboardUrl: `${PREVIEW_ORIGIN}/dashboard`,
    }),
  },
  {
    slug: "password-reset",
    name: "Password reset (support-initiated)",
    journey: "support",
    subject: `Sign back in to Repodcast, ${DEMO_FIRST_NAME}`,
    purpose:
      "Delivers a one-click Clerk sign-in token (~1h TTL) so a user can recover access without their old password.",
    rationale:
      "Manual only. User-initiated resets go through Clerk directly and never touch this template. Every send lands a `SUPPORT_RESET_PASSWORD` audit row with the operator's identity — the email body names them so the recipient can verify the request wasn't unsolicited.",
    trigger: {
      type: "manual",
      label: "Support action · /root/users → Reset password",
      source: "app/(root)/root/users/actions.ts:96",
    },
    recipient: {
      label: "Any single user",
      lookup: "Clerk primary email on the target user, chosen from the /root/users list.",
    },
    cadence: "On demand — every send lands a SUPPORT_RESET_PASSWORD audit row.",
    senderFn: "sendPasswordResetEmail",
    element: PasswordResetEmail({
      firstName: DEMO_FIRST_NAME,
      signInUrl: `${PREVIEW_ORIGIN}/sign-in?__clerk_ticket=sit_2Kq9L3mNpXr8`,
      initiatedBy: "Marcus (Repodcast support)",
      expiresAtIso: "2026-07-03T15:30:00Z",
    }),
  },

  // ------------------------------------------------------------
  // Internal notifications — routed to CONTACT_EMAILS.support
  // ------------------------------------------------------------
  {
    slug: "support-user-signup",
    name: "Signup ping (internal)",
    journey: "internal",
    subject: `[Signup] ${DEMO_AGENCY} · owner@example.com`,
    purpose:
      "Notifies the support inbox the moment a new agency is created — the earliest signal that someone is on board.",
    rationale:
      "Fires from `createAgencyForUser` alongside the user-facing WelcomeEmail. The durable record is the Agency + first Member row; this email exists so ops notices the signup in real time without polling. Skipped for synthetic `@clerk.local` addresses so pre-verified stubs don't page.",
    trigger: {
      type: "webhook",
      label: "Server action · createAgencyForUser (self-serve signup)",
      source: "server/db/agencies.ts:136",
    },
    recipient: {
      label: "CONTACT_EMAILS.support",
      lookup: "Static — `support@repodcastapp.com` (overridable via CONTACT_EMAIL_SUPPORT).",
    },
    cadence: "Once per agency, at the moment the founding OWNER is created.",
    senderFn: "sendSupportUserSignupEmail",
    element: SupportUserSignupEmail({
      agencyName: DEMO_AGENCY,
      ownerName: `${DEMO_FIRST_NAME} Vega`,
      ownerEmail: "sarah@acme.example.com",
      signedUpAt: new Date("2026-07-18T09:00:00Z"),
      rootUsersUrl: `${PREVIEW_ORIGIN}/root/users`,
    }),
  },
  {
    slug: "support-onboarding-complete",
    name: "Onboarding complete (internal)",
    journey: "internal",
    subject: `[Onboarding ✓] ${DEMO_AGENCY} → ${Plan.STUDIO} (trial)`,
    purpose:
      "Notifies the support inbox when a new agency finishes onboarding by completing Checkout — trial or direct paid.",
    rationale:
      "Fires from the Stripe `subscription.created` handler in the same block as the user-facing Trial Welcome email. Covers both flavours (trialing / paid) so the team sees not just that the signup arrived (that's the earlier ping) but that they actually crossed the paywall.",
    trigger: {
      type: "webhook",
      label: "Stripe webhook · subscription.created (all statuses)",
      source: "app/api/webhooks/stripe/route.ts:250",
    },
    recipient: {
      label: "CONTACT_EMAILS.support",
      lookup: "Static — `support@repodcastapp.com` (overridable via CONTACT_EMAIL_SUPPORT).",
    },
    cadence: "Once per subscription create — the transition happens once per agency.",
    senderFn: "sendSupportOnboardingCompleteEmail",
    element: SupportOnboardingCompleteEmail({
      agencyName: DEMO_AGENCY,
      ownerName: `${DEMO_FIRST_NAME} Vega`,
      ownerEmail: "sarah@acme.example.com",
      plan: Plan.STUDIO,
      cadence: BillingCadence.MONTHLY,
      status: "trialing",
      trialEndsAt: TRIAL_END,
      rootUsersUrl: `${PREVIEW_ORIGIN}/root/users`,
    }),
  },
  {
    slug: "support-plan-changed",
    name: "Plan change (internal)",
    journey: "internal",
    subject: `[Plan Upgrade] ${DEMO_AGENCY}: ${Plan.STUDIO} → ${Plan.AGENCY}`,
    purpose:
      "Notifies the support inbox when an already-onboarded agency switches plan or cadence on Stripe.",
    rationale:
      "Fires from the Stripe `subscription.updated` handler when the derived (plan, cadence) differs from what we have on file. Skipped on subscription-create (that's onboarding, above) and skipped on trial → active (that's the trial-converted email). Direction (upgrade / downgrade / cadence) is baked into the subject so triage is instant.",
    trigger: {
      type: "webhook",
      label: "Stripe webhook · subscription.updated (plan or cadence delta)",
      source: "app/api/webhooks/stripe/route.ts:288",
    },
    recipient: {
      label: "CONTACT_EMAILS.support",
      lookup: "Static — `support@repodcastapp.com` (overridable via CONTACT_EMAIL_SUPPORT).",
    },
    cadence: "One per plan/cadence change. No dedupe — Stripe's own event-id dedupe is upstream.",
    senderFn: "sendSupportPlanChangedEmail",
    element: SupportPlanChangedEmail({
      agencyName: DEMO_AGENCY,
      ownerName: `${DEMO_FIRST_NAME} Vega`,
      ownerEmail: "sarah@acme.example.com",
      previousPlan: Plan.STUDIO,
      previousCadence: BillingCadence.MONTHLY,
      newPlan: Plan.AGENCY,
      newCadence: BillingCadence.MONTHLY,
      direction: "upgrade",
      changedAt: new Date("2026-07-18T09:00:00Z"),
      rootUsersUrl: `${PREVIEW_ORIGIN}/root/users`,
    }),
  },
];

export function getEmailBySlug(slug: string): EmailEntry | undefined {
  return EMAILS.find((e) => e.slug === slug);
}

export function groupEmailsByJourney(): Array<{
  key: EmailJourneyKey;
  title: string;
  blurb: string;
  entries: EmailEntry[];
}> {
  const grouped = new Map<EmailJourneyKey, EmailEntry[]>();
  for (const entry of EMAILS) {
    const list = grouped.get(entry.journey) ?? [];
    list.push(entry);
    grouped.set(entry.journey, list);
  }
  return (Object.keys(EMAIL_JOURNEYS) as EmailJourneyKey[])
    .map((key) => ({
      key,
      title: EMAIL_JOURNEYS[key].title,
      blurb: EMAIL_JOURNEYS[key].blurb,
      order: EMAIL_JOURNEYS[key].order,
      entries: grouped.get(key) ?? [],
    }))
    .sort((a, b) => a.order - b.order)
    .map(({ key, title, blurb, entries }) => ({ key, title, blurb, entries }));
}
