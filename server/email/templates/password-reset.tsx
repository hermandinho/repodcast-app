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

export type PasswordResetEmailProps = {
  firstName: string;
  /** One-click sign-in link minted by Clerk. Bypasses the current
   *  password so the user can get back in and set a new one from
   *  Settings → Security. */
  signInUrl: string;
  /**
   * Who triggered this email — the ROOT operator's identity, shown so
   * the recipient knows this wasn't unsolicited. Support agents
   * initiating a reset should include their name in the note that
   * accompanies the send so we can attribute if needed.
   */
  initiatedBy: string;
  expiresAtIso: string;
};

/**
 * Phase 3.6.9 — support-initiated password recovery email. Not
 * automated; only fires when a ROOT/OPERATOR clicks "Reset password"
 * on `/root/users`. The email carries a Clerk sign-in token URL
 * (expires in ~1h) that lets the user land inside their account
 * without their old password.
 */
export function PasswordResetEmail({
  firstName,
  signInUrl,
  initiatedBy,
  expiresAtIso,
}: PasswordResetEmailProps) {
  const expiresLabel = expiresAtIso.slice(0, 16).replace("T", " ");
  return (
    <Html>
      <Head />
      <Preview>Sign back in to Repodcast — one-click link inside</Preview>
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
            Sign back in, {firstName}.
          </Heading>
          <Text style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "0 0 12px" }}>
            {initiatedBy} generated a one-click sign-in link for your Repodcast account. Click the
            button below and you&apos;ll land straight in the dashboard — no current password
            needed. Once you&apos;re in, head to Settings → Security to set a fresh password.
          </Text>
          <Section style={{ textAlign: "center", margin: "24px 0 8px" }}>
            <Button
              href={signInUrl}
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
              Sign in to Repodcast
            </Button>
          </Section>
          <Text style={{ fontSize: 12, lineHeight: 1.5, color: MUTED, margin: "16px 0" }}>
            This link expires at {expiresLabel} UTC and is single-use. If you didn&apos;t request
            this, ignore the email — the link expires on its own.
          </Text>
          <Hr style={{ borderColor: "#E6EBF3", margin: "24px 0 16px" }} />
          <Text style={{ fontSize: 12, color: MUTED, margin: 0 }}>
            Need more help? Reply to this email — it lands in our shared inbox.
            <br />
            <Link href={signInUrl} style={{ color: ACCENT }}>
              {signInUrl}
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
