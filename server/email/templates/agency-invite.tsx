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

const ACCENT = "#3A5BA0";
const INK = "#1A2A4A";
const MUTED = "#5A6473";

export type AgencyInviteEmailProps = {
  inviterName: string;
  agencyName: string;
  roleLabel: "Admin" | "Editor";
  acceptUrl: string;
  /**
   * Human-friendly TTL phrase (e.g. "14 days") matched to the actual
   * expiry on the `MemberInvite` row. Keep these in sync if you tune
   * `INVITE_TTL_DAYS`.
   */
  expiresIn: string;
};

export function AgencyInviteEmail({
  inviterName,
  agencyName,
  roleLabel,
  acceptUrl,
  expiresIn,
}: AgencyInviteEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        {inviterName} invited you to join {agencyName} on Repodcast.
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
            style={{
              fontFamily: "Sora, sans-serif",
              fontSize: 22,
              color: INK,
              margin: "0 0 14px",
            }}
          >
            You&apos;re invited to {agencyName}
          </Heading>
          <Text
            style={{
              fontSize: 14,
              lineHeight: 1.55,
              color: MUTED,
              margin: "0 0 12px",
            }}
          >
            {inviterName} added you as an <strong>{roleLabel}</strong> on{" "}
            <strong>{agencyName}</strong>&apos;s Repodcast workspace.
            {roleLabel === "Admin"
              ? " You'll be able to manage clients, episodes, voice rules, billing, and teammates."
              : " You'll be able to generate, edit, and approve outputs."}
          </Text>
          <Text
            style={{
              fontSize: 14,
              lineHeight: 1.55,
              color: MUTED,
              margin: "0 0 20px",
            }}
          >
            This invite is good for {expiresIn} from when it was sent.
          </Text>
          <Container style={{ textAlign: "center", margin: "28px 0 8px" }}>
            <Button
              href={acceptUrl}
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
              Accept invitation
            </Button>
          </Container>
          <Hr style={{ borderColor: "#E6EBF3", margin: "28px 0 18px" }} />
          <Text style={{ fontSize: 12, color: MUTED, margin: "0 0 8px" }}>
            Or paste this link in your browser:
          </Text>
          <Text style={{ fontSize: 12, color: ACCENT, margin: 0 }}>
            <Link href={acceptUrl} style={{ color: ACCENT }}>
              {acceptUrl}
            </Link>
          </Text>
          <Text style={{ fontSize: 12, color: MUTED, margin: "20px 0 0" }}>
            If you weren&apos;t expecting this, you can ignore the email — the invite will expire on
            its own.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
