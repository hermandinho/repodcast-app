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

/**
 * Sent from the webhook on `subscription.deleted` when the deleted sub was a
 * trial that Stripe couldn't charge (`cancellation_details.reason !==
 * "cancellation_requested"`). We only send this to former ACTIVE trials —
 * paid-customer churn takes a different path.
 *
 * NOT sent when the user proactively canceled their trial: that path is quiet
 * by design (we don't want to guilt-trip active cancellations).
 */

const ACCENT = "#3A5BA0";
const INK = "#1A2A4A";
const MUTED = "#5A6473";

export type TrialExpiredEmailProps = {
  agencyName: string;
  /** Absolute URL to /settings/billing where they can start a fresh sub. */
  billingUrl: string;
};

export function TrialExpiredEmail({ agencyName, billingUrl }: TrialExpiredEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{`${agencyName}: your trial ended — we couldn't complete the first charge.`}</Preview>
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
              color: "#A02B1C",
              margin: "0 0 8px",
            }}
          >
            Trial ended
          </Text>
          <Heading
            style={{ fontFamily: "Sora, sans-serif", fontSize: 22, color: INK, margin: "0 0 14px" }}
          >
            {agencyName} — your trial ended without a charge.
          </Heading>
          <Text style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "0 0 12px" }}>
            Stripe couldn&apos;t complete the first invoice on your card. Your workspace is intact —
            everything you generated is still there — but you&apos;re now on STUDIO with the smaller
            limits.
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "0 0 20px" }}>
            Fix the card in Settings → Billing to pick up right where you were. If you meant to let
            it lapse, ignore this — nothing more will happen.
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
              Update card
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
