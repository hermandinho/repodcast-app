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
 * Sent from the webhook on the `trialing → active` transition (day 8 charge
 * success). Marketing wants a "trial converted" moment for tracking, and the
 * email doubles as a nice-to-have "thanks" plus a link to the first invoice.
 */

const ACCENT = "#3A5BA0";
const INK = "#1A2A4A";
const MUTED = "#5A6473";

export type TrialConvertedEmailProps = {
  agencyName: string;
  plan: Plan;
  /** Absolute URL to /settings/billing. */
  billingUrl: string;
};

export function TrialConvertedEmail({ agencyName, plan, billingUrl }: TrialConvertedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{`${agencyName}: your trial converted to ${plan}. Thanks for staying with us.`}</Preview>
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
            You&apos;re on {plan}
          </Text>
          <Heading
            style={{ fontFamily: "Sora, sans-serif", fontSize: 22, color: INK, margin: "0 0 14px" }}
          >
            Thanks for staying, {agencyName}.
          </Heading>
          <Text style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "0 0 12px" }}>
            Your trial converted — your first invoice is available in Settings → Billing, and every
            future one will be too. Nothing else changes: same workspace, same voice models, same
            approvals.
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
              View invoice
            </Button>
          </Container>
          <Hr style={{ borderColor: "#E6EBF3", margin: "28px 0 18px" }} />
          <Text style={{ fontSize: 12, color: MUTED, margin: 0 }}>
            <Link href={billingUrl} style={{ color: ACCENT }}>
              {billingUrl}
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
