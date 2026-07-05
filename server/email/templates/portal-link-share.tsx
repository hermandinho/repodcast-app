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

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});

export type PortalLinkShareEmailProps = {
  /** Client contact — greeting salutation. Falls back to "there" when blank. */
  contactName: string;
  /** Agency name — signs the email and names the sender. */
  agencyName: string;
  /** White-label brand logo (R2 URL) — hidden when null. */
  brandLogoUrl: string | null;
  /** White-label accent color — falls back to Repodcast navy. */
  brandAccentColor: string | null;
  /** Absolute URL: `${origin}/portal/${token}`. */
  portalUrl: string;
  /** Plaintext password — null when the link isn't protected. Only place
   *  we ever surface this to the client; the DB stores it plaintext and
   *  the agency can copy it out of the mint dialog too. */
  password: string | null;
  /** Link's absolute expiry. */
  expiresAt: Date;
};

export function PortalLinkShareEmail({
  contactName,
  agencyName,
  brandLogoUrl,
  brandAccentColor,
  portalUrl,
  password,
  expiresAt,
}: PortalLinkShareEmailProps) {
  const accent = brandAccentColor ?? DEFAULT_ACCENT;
  const expiryLine = DATE_FMT.format(expiresAt);

  return (
    <Html>
      <Head />
      <Preview>
        {password
          ? `${agencyName} shared a private link with you`
          : `${agencyName} shared your portal link`}
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
            Your portal link is ready
          </Heading>
          <Text style={{ fontSize: 14, lineHeight: 1.6, color: MUTED, margin: "0 0 22px" }}>
            Hey {contactName || "there"} — {agencyName} put together a private page for you to
            review deliverables, leave feedback, and grab links to posts once they go live.
          </Text>

          <Section style={{ textAlign: "center", margin: "0 0 22px" }}>
            <Button
              href={portalUrl}
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
              Open your portal
            </Button>
          </Section>

          {password ? (
            <Section
              style={{
                background: "#FDF6E9",
                border: "1px solid #F0DFB2",
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
                  color: "#946C1E",
                  margin: "0 0 6px",
                }}
              >
                Password to enter
              </Text>
              <Text
                style={{
                  fontSize: 18,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontWeight: 600,
                  color: "#5C4210",
                  letterSpacing: "0.02em",
                  margin: "0 0 8px",
                  wordBreak: "break-all",
                }}
              >
                {password}
              </Text>
              <Text style={{ fontSize: 12, lineHeight: 1.5, color: MUTED, margin: 0 }}>
                Type this on the portal page after opening the link above. Keep it private — anyone
                with both the URL and password can see your deliverables.
              </Text>
            </Section>
          ) : null}

          <Section
            style={{
              background: "#F8FAFD",
              border: "1px solid #E4E8F0",
              borderRadius: 12,
              padding: "14px 16px",
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
                margin: "0 0 4px",
              }}
            >
              Active through
            </Text>
            <Text style={{ fontSize: 13, color: INK, margin: 0 }}>{expiryLine}</Text>
          </Section>

          <Hr style={{ borderColor: "#E6EBF3", margin: "24px 0 16px" }} />
          <Text style={{ fontSize: 12, lineHeight: 1.6, color: MUTED, margin: 0 }}>
            Reply to this email if the link isn&apos;t working or you have questions for the{" "}
            {agencyName} team.
          </Text>
          <Text
            style={{ fontSize: 11, color: "#9AA3B2", margin: "8px 0 0", wordBreak: "break-all" }}
          >
            <Link href={portalUrl} style={{ color: accent }}>
              {portalUrl}
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
