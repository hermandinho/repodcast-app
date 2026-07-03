import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Text,
} from "@react-email/components";
import type { Plan } from "@prisma/client";

/**
 * Trial-ending-soon nudge (T-3 days).
 *
 * Fired by the Stripe webhook on `customer.subscription.trial_will_end`.
 * Stripe drives the timing (~3 days pre-end), so this email lands consistently
 * whether the trial started at 09:00 or 03:00 and even on weekends. The CTA
 * points at `/settings/billing`, where the user can either sit tight (default
 * = convert on day 15) or open the Stripe Customer Portal to cancel.
 */

const ACCENT = "#3A5BA0";
const INK = "#1A2A4A";
const MUTED = "#5A6473";

export type TrialEndingSoonEmailProps = {
  agencyName: string;
  plan: Plan;
  trialEndsAt: Date;
  /** Absolute URL to /settings/billing. */
  billingUrl: string;
};

function daysUntil(target: Date): number {
  const ms = target.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export function TrialEndingSoonEmail({
  agencyName,
  plan,
  trialEndsAt,
  billingUrl,
}: TrialEndingSoonEmailProps) {
  const daysLeft = daysUntil(trialEndsAt);
  return (
    <Html>
      <Head />
      <Preview>{`${agencyName}: your trial ends in ${daysLeft} days.`}</Preview>
      <Body
        style={{
          background: "#F4F6FA",
          fontFamily: "Inter, sans-serif",
          color: INK,
          margin: 0,
          padding: 0,
        }}
      >
        <Container
          style={{
            maxWidth: 560,
            margin: "32px auto",
            padding: 24,
            background: "#fff",
            borderRadius: 16,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: ACCENT,
              margin: "0 0 8px",
            }}
          >
            {daysLeft === 0 ? "Trial ends today" : `Trial ends in ${daysLeft} days`}
          </Text>
          <Heading
            style={{ fontFamily: "Sora, sans-serif", fontSize: 22, color: INK, margin: "0 0 14px" }}
          >
            {agencyName} — your {plan} trial ends {trialEndsAt.toDateString()}.
          </Heading>
          <Text style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "0 0 12px" }}>
            You&apos;re all set — nothing to do. Your card on file will be charged for the first
            billing cycle when the trial converts. Everything you&apos;ve generated so far stays
            with you.
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "0 0 20px" }}>
            Not ready? You can cancel before {trialEndsAt.toDateString()} from your billing settings
            — no charge, no questions.
          </Text>
          <Container style={{ textAlign: "center", margin: "28px 0 8px" }}>
            <Button
              href={billingUrl}
              style={{
                background: ACCENT,
                color: "#fff",
                fontWeight: 600,
                fontSize: 14,
                padding: "12px 22px",
                borderRadius: 10,
                textDecoration: "none",
              }}
            >
              Manage billing
            </Button>
          </Container>
          <Hr style={{ borderColor: "#E6EBF3", margin: "28px 0 18px" }} />
          <Text style={{ fontSize: 12, color: MUTED, margin: "0 0 8px" }}>
            Or paste this link in your browser:
          </Text>
          <Text style={{ fontSize: 12, color: ACCENT, margin: 0 }}>
            <Link href={billingUrl} style={{ color: ACCENT }}>
              {billingUrl}
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
