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
 * Mid-trial portal-preview nudge. Sent by the Inngest `check-trial-nudges`
 * cron on day-2 of the trial window. Purpose is to close the loop between
 * "you generated outputs" and "this is what your clients see" — the
 * client-portal aha moment is a leading indicator of trial → paid conversion.
 *
 * Copy leans on generated activity if we have it (`outputCount`), and
 * degrades gracefully to a generic prompt if the trialist hasn't produced
 * anything yet.
 */

const ACCENT = "#3A5BA0";
const INK = "#1A2A4A";
const MUTED = "#5A6473";

export type TrialDay2EmailProps = {
  firstName: string;
  agencyName: string;
  /** Number of outputs the agency has produced since the trial started. */
  outputCount: number;
  /** Absolute URL to /clients (where portal links are minted). */
  clientsUrl: string;
};

export function TrialDay2Email({
  firstName,
  agencyName,
  outputCount,
  clientsUrl,
}: TrialDay2EmailProps) {
  const hasOutputs = outputCount > 0;
  return (
    <Html>
      <Head />
      <Preview>
        {hasOutputs
          ? `${outputCount} output${outputCount === 1 ? "" : "s"} generated — here's what your clients see.`
          : `Two days in — here's how to show a client what ${agencyName} produces.`}
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
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: ACCENT,
              margin: "0 0 8px",
            }}
          >
            Mid-trial · portal preview
          </Text>
          <Heading
            style={{ fontFamily: "Sora, sans-serif", fontSize: 22, color: INK, margin: "0 0 14px" }}
          >
            {firstName}, here&apos;s what your client actually sees.
          </Heading>
          {hasOutputs ? (
            <Text style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "0 0 12px" }}>
              You&apos;ve generated <strong>{outputCount}</strong> output
              {outputCount === 1 ? "" : "s"} so far. Every one of those can be shared with the
              client through a per-client portal — read-only, no login, branded to your studio.
            </Text>
          ) : (
            <Text style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "0 0 12px" }}>
              Even one generated episode makes a great portal demo. It&apos;s a read-only, no-login
              page you can share with a client to preview the deliverable — branded to your studio.
            </Text>
          )}
          <Text style={{ fontSize: 14, lineHeight: 1.55, color: MUTED, margin: "0 0 20px" }}>
            Mint a portal link on any client&apos;s page under Clients → [name] → Portal. Share the
            link, watch them scroll — that&apos;s the moment agencies tell us tips over into
            &quot;this is worth paying for.&quot;
          </Text>
          <Container style={{ textAlign: "center", margin: "28px 0 8px" }}>
            <Button
              href={clientsUrl}
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
              Open Clients
            </Button>
          </Container>
          <Hr style={{ borderColor: "#E6EBF3", margin: "28px 0 18px" }} />
          <Text style={{ fontSize: 12, color: MUTED, margin: 0 }}>
            Reply to this email if the portal isn&apos;t clicking for you — the founder reads every
            one.
            <br />
            <Link href={clientsUrl} style={{ color: ACCENT }}>
              {clientsUrl}
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
