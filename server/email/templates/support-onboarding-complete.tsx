import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Text,
} from "@react-email/components";
import type { BillingCadence, Plan } from "@prisma/client";

const ACCENT = "#3A5BA0";
const INK = "#1A2A4A";
const MUTED = "#5A6473";

/**
 * Internal notification fired the first time a subscription lands on an
 * agency — the moment they finish onboarding by completing Checkout.
 * Fires for both trial-starts and direct paid subscribes.
 */
export type SupportOnboardingCompleteEmailProps = {
  agencyName: string;
  ownerName: string | null;
  ownerEmail: string;
  plan: Plan;
  cadence: BillingCadence;
  /** "trialing" or "paid" — tells support whether real money moved. */
  status: "trialing" | "paid";
  trialEndsAt: Date | null;
  /** Deep link into the /root/users triage view. */
  rootUsersUrl: string;
};

export function SupportOnboardingCompleteEmail({
  agencyName,
  ownerName,
  ownerEmail,
  plan,
  cadence,
  status,
  trialEndsAt,
  rootUsersUrl,
}: SupportOnboardingCompleteEmailProps) {
  const flavour = status === "trialing" ? "Trial started" : "Direct paid subscribe";
  return (
    <Html>
      <Head />
      <Preview>
        Onboarding done · {agencyName} → {plan} ({flavour})
      </Preview>
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
              fontFamily: "Sora, sans-serif",
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: ACCENT,
              margin: "0 0 8px",
            }}
          >
            Onboarding complete · {flavour}
          </Text>
          <Heading
            style={{
              fontFamily: "Sora, sans-serif",
              fontSize: 22,
              color: INK,
              margin: "0 0 14px",
            }}
          >
            {agencyName} → {plan}
          </Heading>

          <Text style={{ fontSize: 13, lineHeight: 1.55, color: MUTED, margin: "0 0 6px" }}>
            Owner: <strong style={{ color: INK }}>{ownerName ?? ownerEmail}</strong>
            {ownerName ? (
              <>
                {" ("}
                <Link href={`mailto:${ownerEmail}`} style={{ color: ACCENT }}>
                  {ownerEmail}
                </Link>
                {")"}
              </>
            ) : null}
          </Text>
          <Text style={{ fontSize: 13, lineHeight: 1.55, color: MUTED, margin: "0 0 6px" }}>
            Plan: <strong style={{ color: INK }}>{plan}</strong> ({cadence.toLowerCase()})
          </Text>
          <Text style={{ fontSize: 13, lineHeight: 1.55, color: MUTED, margin: "0 0 16px" }}>
            Status: <strong style={{ color: INK }}>{flavour}</strong>
            {trialEndsAt ? (
              <>
                {" · trial ends "}
                <strong style={{ color: INK }}>{trialEndsAt.toUTCString()}</strong>
              </>
            ) : null}
          </Text>

          <Hr style={{ borderColor: "#E6EBF3", margin: "20px 0 14px" }} />
          <Text style={{ fontSize: 12, color: MUTED, margin: 0 }}>
            Open in ROOT:{" "}
            <Link href={rootUsersUrl} style={{ color: ACCENT }}>
              {rootUsersUrl}
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
