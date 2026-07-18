import { Body, Container, Head, Heading, Hr, Html, Preview, Text } from "@react-email/components";

const ACCENT = "#3A5BA0";
const INK = "#1A2A4A";
const MUTED = "#5A6473";

/**
 * User-facing confirmation for the `/contact` support form. Sent to the
 * submitter's email right after the ticket lands, giving them the ref
 * code to quote when they reply. Fire-and-forget from the server action.
 */
export type SupportTicketConfirmationEmailProps = {
  submitterName: string;
  refCode: string;
  subject: string;
  supportEmail: string;
};

export function SupportTicketConfirmationEmail({
  submitterName,
  refCode,
  subject,
  supportEmail,
}: SupportTicketConfirmationEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>We got your message — reference {refCode}</Preview>
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
            Ticket received
          </Text>
          <Heading
            style={{
              fontFamily: "Sora, sans-serif",
              fontSize: 22,
              color: INK,
              margin: "0 0 14px",
            }}
          >
            Thanks, {submitterName} — we&rsquo;ve got it.
          </Heading>

          <Text style={{ fontSize: 14, lineHeight: 1.65, color: INK, margin: "0 0 14px" }}>
            Your message landed in our support queue. A human will read it and reply within one
            business day.
          </Text>

          <div
            style={{
              background: "#F4F6FA",
              borderRadius: 10,
              padding: "14px 16px",
              margin: "0 0 18px",
              fontSize: 13.5,
              lineHeight: 1.55,
              color: INK,
            }}
          >
            <Text style={{ margin: "0 0 4px", fontSize: 12, color: MUTED }}>Your reference</Text>
            <Text
              style={{
                margin: 0,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 15,
                fontWeight: 600,
                color: INK,
              }}
            >
              {refCode}
            </Text>
            <Text style={{ margin: "10px 0 4px", fontSize: 12, color: MUTED }}>Subject</Text>
            <Text style={{ margin: 0, fontSize: 13.5, color: INK }}>{subject}</Text>
          </div>

          <Text style={{ fontSize: 13, lineHeight: 1.6, color: MUTED, margin: "0 0 14px" }}>
            Need to add something? Just reply to this email — the reference above will thread
            everything together. You can also write to{" "}
            <a href={`mailto:${supportEmail}`} style={{ color: ACCENT }}>
              {supportEmail}
            </a>{" "}
            directly and quote <strong style={{ color: INK }}>{refCode}</strong>.
          </Text>

          <Hr style={{ borderColor: "#E6EBF3", margin: "20px 0 14px" }} />
          <Text style={{ fontSize: 12, color: MUTED, margin: 0 }}>— The Repodcast team</Text>
        </Container>
      </Body>
    </Html>
  );
}
