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
 * Internal notification fired when an existing agency's subscription
 * plan or cadence changes on Stripe. Skips the trial → active
 * transition (that's covered by the onboarding-complete + trial-
 * converted flows) and no-op updates where nothing user-visible moved.
 */
export type SupportPlanChangedEmailProps = {
  agencyName: string;
  ownerName: string | null;
  ownerEmail: string;
  previousPlan: Plan;
  previousCadence: BillingCadence;
  newPlan: Plan;
  newCadence: BillingCadence;
  /** "upgrade" | "downgrade" | "cadence" — helps triage at a glance. */
  direction: "upgrade" | "downgrade" | "cadence";
  changedAt: Date;
  rootUsersUrl: string;
};

const DIRECTION_LABEL: Record<SupportPlanChangedEmailProps["direction"], string> = {
  upgrade: "Upgrade",
  downgrade: "Downgrade",
  cadence: "Cadence change",
};

export function SupportPlanChangedEmail({
  agencyName,
  ownerName,
  ownerEmail,
  previousPlan,
  previousCadence,
  newPlan,
  newCadence,
  direction,
  changedAt,
  rootUsersUrl,
}: SupportPlanChangedEmailProps) {
  const label = DIRECTION_LABEL[direction];
  return (
    <Html>
      <Head />
      <Preview>
        {label} · {agencyName}: {previousPlan} → {newPlan}
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
            Plan change · {label}
          </Text>
          <Heading
            style={{
              fontFamily: "Sora, sans-serif",
              fontSize: 22,
              color: INK,
              margin: "0 0 14px",
            }}
          >
            {agencyName}
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
            From:{" "}
            <strong style={{ color: INK }}>
              {previousPlan} ({previousCadence.toLowerCase()})
            </strong>
          </Text>
          <Text style={{ fontSize: 13, lineHeight: 1.55, color: MUTED, margin: "0 0 6px" }}>
            To:{" "}
            <strong style={{ color: INK }}>
              {newPlan} ({newCadence.toLowerCase()})
            </strong>
          </Text>
          <Text style={{ fontSize: 13, lineHeight: 1.55, color: MUTED, margin: "0 0 16px" }}>
            When: <strong style={{ color: INK }}>{changedAt.toUTCString()}</strong>
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
