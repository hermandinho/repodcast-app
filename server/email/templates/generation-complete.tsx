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
const SUCCESS = "#1E7A47";

export type GenerationCompleteEmailProps = {
  recipientName: string;
  episodeTitle: string;
  clientName: string;
  outputCount: number;
  failedPlatforms: string[];
  episodeUrl: string;
};

export function GenerationCompleteEmail({
  recipientName,
  episodeTitle,
  clientName,
  outputCount,
  failedPlatforms,
  episodeUrl,
}: GenerationCompleteEmailProps) {
  const allGood = failedPlatforms.length === 0;
  return (
    <Html>
      <Head />
      <Preview>
        {allGood
          ? `${outputCount} outputs ready to review for ${episodeTitle}`
          : `${outputCount} outputs ready · ${failedPlatforms.length} need attention`}
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
          <Heading
            style={{ fontFamily: "Sora, sans-serif", fontSize: 20, color: INK, margin: "0 0 12px" }}
          >
            Outputs ready for {clientName}
          </Heading>
          <Text style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "0 0 16px" }}>
            Hey {recipientName} — we just finished generating outputs for{" "}
            <strong style={{ color: INK }}>{episodeTitle}</strong>.
          </Text>

          <Section
            style={{
              background: "#EEF2FB",
              border: "1px solid #DDE5F4",
              borderRadius: 12,
              padding: "16px 18px",
              margin: "0 0 18px",
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: 600, color: ACCENT, margin: "0 0 6px" }}>
              {outputCount} ready to review
            </Text>
            <Text style={{ fontSize: 13, color: MUTED, margin: 0 }}>
              Approve the ones you&apos;d post as-is. Each approval feeds the host&apos;s voice
              profile so future drafts land closer to perfect.
            </Text>
          </Section>

          {!allGood && (
            <Section
              style={{
                background: "#FBF1DE",
                border: "1px solid #F0E3CB",
                borderRadius: 12,
                padding: "16px 18px",
                margin: "0 0 18px",
              }}
            >
              <Text style={{ fontSize: 14, fontWeight: 600, color: "#A06D12", margin: "0 0 6px" }}>
                {failedPlatforms.length} platform{failedPlatforms.length === 1 ? "" : "s"} need a
                retry
              </Text>
              <Text style={{ fontSize: 13, color: MUTED, margin: 0 }}>
                {failedPlatforms.join(", ")} — hit Regenerate on each card to try again.
              </Text>
            </Section>
          )}

          <Section style={{ textAlign: "center", margin: "20px 0 8px" }}>
            <Button
              href={episodeUrl}
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
              Review outputs
            </Button>
          </Section>

          <Hr style={{ borderColor: "#E6EBF3", margin: "28px 0 18px" }} />
          <Text style={{ fontSize: 12, color: MUTED, margin: 0 }}>
            Voice training tip: aim for at least 16 approved samples per platform to push that
            strength meter to <span style={{ color: SUCCESS, fontWeight: 600 }}>Strong</span>.
            <br />
            <Link href={episodeUrl} style={{ color: ACCENT }}>
              {episodeUrl}
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
