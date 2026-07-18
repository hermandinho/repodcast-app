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

const ACCENT = "#3A5BA0";
const INK = "#1A2A4A";
const MUTED = "#5A6473";

/**
 * Internal notification fired when a brand-new agency is created — i.e. a
 * founding OWNER just signed up. Lands in `CONTACT_EMAILS.support` so the
 * team notices the arrival in real time; the durable record is the `Agency`
 * row + first `Member` row.
 */
export type SupportUserSignupEmailProps = {
  agencyName: string;
  ownerName: string | null;
  ownerEmail: string;
  signedUpAt: Date;
  /** Deep link into the /root/users triage view for this member. */
  rootUsersUrl: string;
};

export function SupportUserSignupEmail({
  agencyName,
  ownerName,
  ownerEmail,
  signedUpAt,
  rootUsersUrl,
}: SupportUserSignupEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>
        New signup · {agencyName} ({ownerEmail})
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
            New signup · agency created
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
          <Text style={{ fontSize: 13, lineHeight: 1.55, color: MUTED, margin: "0 0 16px" }}>
            Signed up: <strong style={{ color: INK }}>{signedUpAt.toUTCString()}</strong>
          </Text>

          <Text style={{ fontSize: 13, lineHeight: 1.55, color: MUTED, margin: "0 0 12px" }}>
            No plan picked yet — the workspace is one step into the onboarding wizard. Watch for the
            follow-up onboarding-complete ping when they finish Checkout.
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
