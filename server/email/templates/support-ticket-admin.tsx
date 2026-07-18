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
 * Internal-facing notification for `CONTACT_EMAILS.support` when a user
 * submits the `/contact` support form. Best-effort mirror of the
 * durable `SupportTicket` row — the row is the source of truth and the
 * (deferred) `/root/support` triage queue will read from it.
 */
export type SupportTicketAdminEmailProps = {
  category: "BUG" | "QUESTION" | "BILLING" | "ACCOUNT" | "FEATURE_REQUEST" | "OTHER";
  refCode: string;
  subject: string;
  body: string;
  submitterName: string;
  submitterEmail: string;
  /** Present when the submitter was signed in. */
  agencyName: string | null;
  contextUrl: string | null;
  /** Direct reply-to helper — mailto pre-filled with the ref code in the subject. */
  replyMailto: string;
  /** Deep link into the `/root/support` triage queue. */
  triageUrl: string;
};

const CATEGORY_LABEL: Record<SupportTicketAdminEmailProps["category"], string> = {
  BUG: "Bug",
  QUESTION: "Question",
  BILLING: "Billing",
  ACCOUNT: "Account",
  FEATURE_REQUEST: "Feature request",
  OTHER: "Other",
};

export function SupportTicketAdminEmail({
  category,
  refCode,
  subject,
  body,
  submitterName,
  submitterEmail,
  agencyName,
  contextUrl,
  replyMailto,
  triageUrl,
}: SupportTicketAdminEmailProps) {
  const label = CATEGORY_LABEL[category];
  return (
    <Html>
      <Head />
      <Preview>
        [{refCode}] {label}: {subject}
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
            New support ticket · {label}
          </Text>
          <Heading
            style={{
              fontFamily: "Sora, sans-serif",
              fontSize: 22,
              color: INK,
              margin: "0 0 6px",
            }}
          >
            {subject}
          </Heading>
          <Text
            style={{
              fontFamily: "Sora, sans-serif",
              fontSize: 12,
              color: MUTED,
              margin: "0 0 14px",
            }}
          >
            Ref <strong style={{ color: INK }}>{refCode}</strong>
          </Text>

          <Text
            style={{
              fontSize: 13,
              lineHeight: 1.55,
              color: MUTED,
              margin: "0 0 16px",
            }}
          >
            From <strong style={{ color: INK }}>{submitterName}</strong>
            {" ("}
            <Link href={`mailto:${submitterEmail}`} style={{ color: ACCENT }}>
              {submitterEmail}
            </Link>
            {")"}
            {agencyName ? (
              <>
                {" · "}
                <span style={{ color: INK }}>{agencyName}</span>
              </>
            ) : (
              <> · anonymous / signed-out</>
            )}
          </Text>

          <div
            style={{
              background: "#F4F6FA",
              borderRadius: 10,
              padding: "14px 16px",
              margin: "0 0 18px",
              whiteSpace: "pre-wrap",
              fontSize: 13.5,
              lineHeight: 1.55,
              color: INK,
            }}
          >
            {body}
          </div>

          {contextUrl ? (
            <Text style={{ fontSize: 12, color: MUTED, margin: "0 0 14px" }}>
              Context URL:{" "}
              <code
                style={{
                  background: "#EEF1F6",
                  padding: "1px 6px",
                  borderRadius: 4,
                  fontSize: 12,
                }}
              >
                {contextUrl}
              </code>
            </Text>
          ) : null}

          <Hr style={{ borderColor: "#E6EBF3", margin: "20px 0 14px" }} />
          <Text style={{ fontSize: 12, color: MUTED, margin: "0 0 6px" }}>
            Reply directly:{" "}
            <Link href={replyMailto} style={{ color: ACCENT }}>
              {submitterEmail}
            </Link>
          </Text>
          <Text style={{ fontSize: 12, color: MUTED, margin: 0 }}>
            Open in ROOT:{" "}
            <Link href={triageUrl} style={{ color: ACCENT }}>
              {triageUrl}
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
