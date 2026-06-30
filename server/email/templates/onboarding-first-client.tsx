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
 * Phase 2.10 — "Add your first client" nudge.
 *
 * Sent by the hourly `onboarding/check-nudges` Inngest cron ~72h after
 * `Agency.createdAt` whenever the agency still has zero `Client` rows.
 * Decoupled from the 24h "finish setup" nudge — both fire on their own
 * markers (the design call: escalating reminders are fine, the dedupe table
 * makes sure neither one fires twice).
 */
const ACCENT = "#3A5BA0";
const INK = "#1A2A4A";
const MUTED = "#5A6473";

export type OnboardingFirstClientEmailProps = {
  firstName: string;
  agencyName: string;
  /** Deep link to `/clients`, where the New Client modal is one click away. */
  newClientUrl: string;
};

export function OnboardingFirstClientEmail({
  firstName,
  agencyName,
  newClientUrl,
}: OnboardingFirstClientEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{`${agencyName} is set up — add a client and your first episode is one paste away.`}</Preview>
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
            Your first generation is one client away
          </Text>
          <Heading
            style={{ fontFamily: "Sora, sans-serif", fontSize: 22, color: INK, margin: "0 0 14px" }}
          >
            {firstName}, add your first client.
          </Heading>
          <Text style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "0 0 12px" }}>
            {agencyName} is wired up and waiting on a client. Clients are the agencies and companies
            you produce content for — one per relationship, with shows nested underneath.
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "0 0 20px" }}>
            Once a client is in, paste a transcript on the New Episode wizard and your seven
            platform outputs land in under a minute.
          </Text>
          <Container style={{ textAlign: "center", margin: "28px 0 8px" }}>
            <Button
              href={newClientUrl}
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
              Add your first client
            </Button>
          </Container>
          <Hr style={{ borderColor: "#E6EBF3", margin: "28px 0 18px" }} />
          <Text style={{ fontSize: 12, color: MUTED, margin: "0 0 8px" }}>
            Or paste this link in your browser:
          </Text>
          <Text style={{ fontSize: 12, color: ACCENT, margin: 0 }}>
            <Link href={newClientUrl} style={{ color: ACCENT }}>
              {newClientUrl}
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
