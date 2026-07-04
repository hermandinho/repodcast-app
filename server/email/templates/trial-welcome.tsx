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
  Section,
  Text,
} from "@react-email/components";
import type { Plan } from "@prisma/client";

/**
 * Sent immediately after the Stripe webhook fires `subscription.created` with
 * status `trialing`. Distinct from `WelcomeEmail` (which is for paid signups)
 * — the trial framing sets expectations for the day-8 recurring charge upfront
 * and confirms the $1 activation charge that already landed on day 0.
 */

const ACCENT = "#3A5BA0";
const INK = "#1A2A4A";
const MUTED = "#5A6473";

export type TrialWelcomeEmailProps = {
  firstName: string;
  agencyName: string;
  plan: Plan;
  trialEndsAt: Date;
  dashboardUrl: string;
};

export function TrialWelcomeEmail({
  firstName,
  agencyName,
  plan,
  trialEndsAt,
  dashboardUrl,
}: TrialWelcomeEmailProps) {
  const endLabel = trialEndsAt.toDateString();
  return (
    <Html>
      <Head />
      <Preview>{`Your ${plan} trial runs through ${endLabel}. Let's get to a first generation.`}</Preview>
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
            Trial started · runs through {endLabel}
          </Text>
          <Heading
            style={{ fontFamily: "Sora, sans-serif", fontSize: 22, color: INK, margin: "0 0 14px" }}
          >
            Welcome, {firstName}.
          </Heading>
          <Text style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "0 0 12px" }}>
            {agencyName} is on {plan} with full access. We charged the $1 activation fee to confirm
            your card is live — your first plan charge lands on <strong>{endLabel}</strong>. Cancel
            any time from Settings → Billing; the $1 is non-refundable.
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "0 0 12px" }}>
            The trial is short — the fastest way to know if this fits is to run one real episode
            through:
          </Text>
          <Section style={{ paddingLeft: 16 }}>
            <Text style={{ fontSize: 14, margin: "0 0 6px" }}>1. Add a client show.</Text>
            <Text style={{ fontSize: 14, margin: "0 0 6px" }}>
              2. Paste a transcript on the New Episode wizard.
            </Text>
            <Text style={{ fontSize: 14, margin: "0 0 6px" }}>
              3. Approve the outputs you like — the voice engine learns as you go.
            </Text>
            <Text style={{ fontSize: 14, margin: "0 0 6px" }}>
              4. Share the portal link with your client to see the deliverable they will.
            </Text>
          </Section>
          <Section style={{ textAlign: "center", margin: "28px 0 8px" }}>
            <Button
              href={dashboardUrl}
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
              Open dashboard
            </Button>
          </Section>
          <Hr style={{ borderColor: "#E6EBF3", margin: "28px 0 18px" }} />
          <Text style={{ fontSize: 12, color: MUTED, margin: 0 }}>
            Reply to this email if anything sticks — a real person reads it.
            <br />
            <Link href={dashboardUrl} style={{ color: ACCENT }}>
              {dashboardUrl}
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
