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
  OnboardingFinishSetupEmail,
  type OnboardingFinishSetupEmailProps,
} from "./templates/onboarding-finish-setup";
import {
  OnboardingFirstClientEmail,
  type OnboardingFirstClientEmailProps,
} from "./templates/onboarding-first-client";
import { WelcomeEmail, type WelcomeEmailProps } from "./templates/welcome";

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
