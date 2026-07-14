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
 * Client-contract renewal reminder.
 *
 * Sent by the daily `billing/check-renewals` Inngest cron at the 30-day and
 * 7-day pre-renewal markers. Recipients are OWNER + ADMIN members of the
 * agency. The CTA routes to `/clients/[key]/billing` so the admin can pull
 * the latest cost-to-serve before talking to the client.
 */
const ACCENT = "#3A5BA0";
const INK = "#1A2A4A";
const MUTED = "#5A6473";
const AMBER = "#A06D12";

export type ClientRenewalReminderEmailProps = {
  agencyName: string;
  clientName: string;
  /** Pre-renewal marker: "30d" or "7d" — drives the headline copy. */
  marker: "30d" | "7d";
  /** Days remaining to the renewal — keeps the email accurate even if the
   *  cron drifts by a few hours from the marker boundary. */
  daysToRenewal: number;
  /** ISO yyyy-mm-dd display string for the renewal date. */
  renewalDateLabel: string;
  /** Deep link to the client's billing tab. */
  billingUrl: string;
};

export function ClientRenewalReminderEmail({
  agencyName,
  clientName,
  marker,
  daysToRenewal,
  renewalDateLabel,
  billingUrl,
}: ClientRenewalReminderEmailProps) {
  const urgency = marker === "7d" ? "7 days" : "30 days";

  return (
    <Html>
      <Head />
      <Preview>
        {`${clientName}'s contract renews in ${daysToRenewal} day${daysToRenewal === 1 ? "" : "s"}.`}
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
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: AMBER,
              margin: "0 0 8px",
            }}
          >
            Renewal in {urgency}
          </Text>
          <Heading
            style={{
              fontFamily: "Sora, sans-serif",
              fontSize: 22,
              color: INK,
              margin: "0 0 14px",
            }}
          >
            {clientName} renews on {renewalDateLabel}
          </Heading>
          <Text
            style={{
              fontSize: 14,
              lineHeight: 1.55,
              color: MUTED,
              margin: "0 0 12px",
            }}
          >
            Heads up — {clientName}&apos;s contract with <strong>{agencyName}</strong> renews in{" "}
            <strong>
              {daysToRenewal} day{daysToRenewal === 1 ? "" : "s"}
            </strong>
            . Now&apos;s a good time to check the cost-to-serve and confirm the next term&apos;s
            scope.
          </Text>
          <Text
            style={{
              fontSize: 14,
              lineHeight: 1.55,
              color: MUTED,
              margin: "0 0 20px",
            }}
          >
            Open the client&apos;s billing tab to see this period&apos;s spend, generate a fresh
            statement, and review the retainer or per-episode rate before your renewal conversation.
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
              Open {clientName}&apos;s billing
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
          <Text style={{ fontSize: 12, color: MUTED, margin: "20px 0 0" }}>
            Renewal reminders can be muted from <strong>Settings → Agency</strong> if you&apos;d
            rather track this elsewhere.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
