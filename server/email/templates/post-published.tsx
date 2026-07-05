import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

const DEFAULT_ACCENT = "#3A5BA0";
const INK = "#1A2A4A";
const MUTED = "#5A6473";

const PLATFORM_LABEL: Record<string, string> = {
  TWITTER: "X / Twitter",
  LINKEDIN: "LinkedIn",
  INSTAGRAM: "Instagram",
  TIKTOK: "TikTok",
  SHOW_NOTES: "Show notes",
  BLOG: "Blog",
  NEWSLETTER: "Newsletter",
};

export type PostPublishedEmailProps = {
  /** Client contact — greeting salutation. Falls back to "there" when blank. */
  contactName: string;
  /** Agency name — signs the email so the client recognises the sender. */
  agencyName: string;
  /** White-label brand logo (R2 URL) — hidden when null. */
  brandLogoUrl: string | null;
  /** White-label accent color for the CTA button. Falls back to Repodcast navy. */
  brandAccentColor: string | null;
  /** "Why Your First 10 Hires…" — the episode this post was drafted from. */
  episodeTitle: string;
  /** Podcast show name — provides context when a client hosts multiple shows. */
  showName: string;
  /** Platform enum value (TWITTER, LINKEDIN, etc.) — humanised in the email. */
  platform: string;
  /** Live URL to the published post; null when the operator marked-published
   *  manually without pasting the URL back. */
  externalPostUrl: string | null;
  /** Timestamp of publish — Buffer's sent_at OR the operator's confirmation. */
  publishedAt: Date;
};

export function PostPublishedEmail({
  contactName,
  agencyName,
  brandLogoUrl,
  brandAccentColor,
  episodeTitle,
  showName,
  platform,
  externalPostUrl,
  publishedAt,
}: PostPublishedEmailProps) {
  const accent = brandAccentColor ?? DEFAULT_ACCENT;
  const platformLabel = PLATFORM_LABEL[platform] ?? platform;
  const dateLine = publishedAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const timeLine = publishedAt.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <Html>
      <Head />
      <Preview>
        Your {platformLabel} post for “{episodeTitle}” is live
      </Preview>
      <Body
        style={{
          background: "#F4F6FA",
          fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif",
          color: INK,
          margin: 0,
          padding: 0,
        }}
      >
        <Container
          style={{
            maxWidth: 560,
            margin: "32px auto",
            padding: 28,
            background: "#fff",
            borderRadius: 16,
          }}
        >
          {brandLogoUrl ? (
            <Section style={{ marginBottom: 20 }}>
              <Img
                src={brandLogoUrl}
                alt={agencyName}
                height="32"
                style={{ maxHeight: 32, display: "block" }}
              />
            </Section>
          ) : null}

          <Heading
            style={{
              fontFamily: "Sora, sans-serif",
              fontSize: 22,
              lineHeight: 1.25,
              color: INK,
              margin: "0 0 10px",
              letterSpacing: "-0.01em",
            }}
          >
            Your {platformLabel} post is live
          </Heading>
          <Text style={{ fontSize: 14, lineHeight: 1.6, color: MUTED, margin: "0 0 22px" }}>
            Hey {contactName || "there"} — {agencyName} just published a post for you.
          </Text>

          <Section
            style={{
              background: "#F8FAFD",
              border: "1px solid #E4E8F0",
              borderRadius: 12,
              padding: "16px 18px",
              margin: "0 0 22px",
            }}
          >
            <Text
              style={{
                fontSize: 10.5,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "#9AA3B2",
                margin: "0 0 6px",
              }}
            >
              Platform
            </Text>
            <Text style={{ fontSize: 15, fontWeight: 600, color: INK, margin: "0 0 12px" }}>
              {platformLabel}
            </Text>

            <Text
              style={{
                fontSize: 10.5,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "#9AA3B2",
                margin: "0 0 6px",
              }}
            >
              Episode
            </Text>
            <Text style={{ fontSize: 14, fontWeight: 500, color: INK, margin: "0 0 4px" }}>
              {episodeTitle}
            </Text>
            <Text style={{ fontSize: 12, color: MUTED, margin: "0 0 12px" }}>{showName}</Text>

            <Text
              style={{
                fontSize: 10.5,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "#9AA3B2",
                margin: "0 0 6px",
              }}
            >
              Published
            </Text>
            <Text style={{ fontSize: 13, color: INK, margin: 0 }}>
              {dateLine} · {timeLine}
            </Text>
          </Section>

          {externalPostUrl ? (
            <Section style={{ textAlign: "center", margin: "8px 0 4px" }}>
              <Button
                href={externalPostUrl}
                style={{
                  background: accent,
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: 14,
                  padding: "12px 26px",
                  borderRadius: 10,
                  textDecoration: "none",
                  display: "inline-block",
                }}
              >
                View the post
              </Button>
            </Section>
          ) : (
            <Text
              style={{
                fontSize: 13,
                color: MUTED,
                margin: "0 0 4px",
                textAlign: "center",
                fontStyle: "italic",
              }}
            >
              We&apos;ll add the live link here once it&apos;s available.
            </Text>
          )}

          <Hr style={{ borderColor: "#E6EBF3", margin: "28px 0 18px" }} />
          <Text style={{ fontSize: 12, lineHeight: 1.6, color: MUTED, margin: 0 }}>
            You&apos;re getting this because you&apos;re listed as the primary contact for your
            account with {agencyName}. Reply to this email if anything looks off.
          </Text>
          {externalPostUrl ? (
            <Text
              style={{ fontSize: 11, color: "#9AA3B2", margin: "8px 0 0", wordBreak: "break-all" }}
            >
              <Link href={externalPostUrl} style={{ color: accent }}>
                {externalPostUrl}
              </Link>
            </Text>
          ) : null}
        </Container>
      </Body>
    </Html>
  );
}
