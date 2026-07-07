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
 * Internal-facing notification fired when a user submits feedback via the
 * dashboard's Feedback button. Delivered to `CONTACT_EMAILS.feedback` — the
 * durable inbox is the `Suggestion` row on `/root/feedback`; this email is a
 * best-effort mirror so we notice new items without polling.
 */
export type SuggestionReceivedEmailProps = {
  type: "BUG" | "FEATURE_REQUEST" | "IMPROVEMENT" | "QUESTION" | "OTHER";
  title: string;
  body: string;
  reporterName: string | null;
  reporterEmail: string;
  agencyName: string | null;
  contextUrl: string | null;
  /** Direct link to the row in the ROOT queue. */
  triageUrl: string;
};

const TYPE_LABEL: Record<SuggestionReceivedEmailProps["type"], string> = {
  BUG: "Bug",
  FEATURE_REQUEST: "Feature request",
  IMPROVEMENT: "Improvement",
  QUESTION: "Question",
  OTHER: "Other",
};

export function SuggestionReceivedEmail({
  type,
  title,
  body,
  reporterName,
  reporterEmail,
  agencyName,
  contextUrl,
  triageUrl,
}: SuggestionReceivedEmailProps) {
  const label = TYPE_LABEL[type];
  return (
    <Html>
      <Head />
      <Preview>
        {label}: {title}
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
            New {label.toLowerCase()}
          </Text>
          <Heading
            style={{
              fontFamily: "Sora, sans-serif",
              fontSize: 22,
              color: INK,
              margin: "0 0 14px",
            }}
          >
            {title}
          </Heading>

          <Text
            style={{
              fontSize: 13,
              lineHeight: 1.55,
              color: MUTED,
              margin: "0 0 16px",
            }}
          >
            From <strong style={{ color: INK }}>{reporterName ?? reporterEmail}</strong>
            {reporterName ? (
              <>
                {" ("}
                <Link href={`mailto:${reporterEmail}`} style={{ color: ACCENT }}>
                  {reporterEmail}
                </Link>
                {")"}
              </>
            ) : null}
            {agencyName ? (
              <>
                {" · "}
                <span style={{ color: INK }}>{agencyName}</span>
              </>
            ) : null}
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
              Submitted from{" "}
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
