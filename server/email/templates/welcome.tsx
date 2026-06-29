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

const ACCENT = "#3A5BA0";
const INK = "#1A2A4A";
const MUTED = "#5A6473";

export type WelcomeEmailProps = {
  firstName: string;
  agencyName: string;
  dashboardUrl: string;
};

export function WelcomeEmail({ firstName, agencyName, dashboardUrl }: WelcomeEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Welcome to Repodcast, {firstName} — your voice engine is ready.</Preview>
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
          <Heading
            style={{ fontFamily: "Sora, sans-serif", fontSize: 22, color: INK, margin: "0 0 14px" }}
          >
            Welcome, {firstName}.
          </Heading>
          <Text style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "0 0 12px" }}>
            {agencyName} is wired up and ready to start producing platform-ready content from
            podcast episodes. Your first episode will look great even with a brand-new voice profile
            — and every approval makes the next batch sound more like the host.
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "0 0 20px" }}>
            Quickest path to a first generation:
          </Text>
          <Section style={{ paddingLeft: 16 }}>
            <Text style={{ fontSize: 14, margin: "0 0 6px" }}>1. Add your first client show.</Text>
            <Text style={{ fontSize: 14, margin: "0 0 6px" }}>
              2. Paste a transcript on the New Episode wizard.
            </Text>
            <Text style={{ fontSize: 14, margin: "0 0 6px" }}>
              3. Approve the outputs you like — that&apos;s how the voice engine learns.
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
            Questions? Reply to this email — it lands in our shared inbox.
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
