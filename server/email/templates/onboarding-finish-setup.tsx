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
 * Phase 2.10 — "Finish setting up" nudge.
 *
 * Sent by the hourly `onboarding/check-nudges` Inngest cron ~24h after
 * `Agency.createdAt` whenever the founding OWNER hasn't pushed
 * `Agency.onboardingStep` to `DONE`. CTA deep-links back to `/onboarding`,
 * which (Phase 2.10 resume gate) drops them onto the exact step they bailed
 * on rather than restarting from step 1.
 */
const ACCENT = "#3A5BA0";
const INK = "#1A2A4A";
const MUTED = "#5A6473";

export type OnboardingFinishSetupEmailProps = {
  firstName: string;
  agencyName: string;
  /** Deep link to `/onboarding` — the resume gate routes to the right step. */
  resumeUrl: string;
};

export function OnboardingFinishSetupEmail({
  firstName,
  agencyName,
  resumeUrl,
}: OnboardingFinishSetupEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{`${agencyName} is wired up — two quick steps to start producing.`}</Preview>
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
            One step from your first generation
          </Text>
          <Heading
            style={{ fontFamily: "Sora, sans-serif", fontSize: 22, color: INK, margin: "0 0 14px" }}
          >
            {firstName}, {agencyName} is ready — let&apos;s finish.
          </Heading>
          <Text style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "0 0 12px" }}>
            You created your workspace yesterday. A couple of quick steps and you&apos;ll be
            generating platform-ready content from your next episode in minutes.
          </Text>
          <Text style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "0 0 20px" }}>
            We saved your progress. The link below picks up at the exact step you left on.
          </Text>
          <Container style={{ textAlign: "center", margin: "28px 0 8px" }}>
            <Button
              href={resumeUrl}
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
              Pick up where you left off
            </Button>
          </Container>
          <Hr style={{ borderColor: "#E6EBF3", margin: "28px 0 18px" }} />
          <Text style={{ fontSize: 12, color: MUTED, margin: "0 0 8px" }}>
            Or paste this link in your browser:
          </Text>
          <Text style={{ fontSize: 12, color: ACCENT, margin: 0 }}>
            <Link href={resumeUrl} style={{ color: ACCENT }}>
              {resumeUrl}
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
