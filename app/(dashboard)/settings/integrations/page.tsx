import { ExternalScheduler, MemberRole } from "@prisma/client";
import { requireAuthContext } from "@/server/auth/context";
import { toTenantContext } from "@/server/auth/tenant";
import { listIntegrationsForAgency } from "@/server/db/integrations";
import { BufferIntegrationCard } from "@/components/settings/buffer-integration-card";

export const dynamic = "force-dynamic";

const INK = "#0a1e3c";
const MUTED = "#41506b";
const LIGHT_MUTED = "#8a97ad";
const CARD_BORDER = "#e4e9f1";
const OUTLINE_STRONG = "#d4dbe7";
const ACCENT = "#3A5BA0";

/**
 * Settings · Integrations — revamp visual system (see `ref/UI/Revamp/` 2c).
 * Structure: status banners at top (buffer connected / disconnected /
 * error), the primary Buffer integration card, then a "on the roadmap"
 * card with two dashed placeholders for coming-soon integrations.
 */
export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ buffer?: string; error?: string }>;
}) {
  const [auth, sp] = await Promise.all([requireAuthContext(), searchParams]);
  const ctx = toTenantContext(auth);
  const integrations = await listIntegrationsForAgency(ctx);
  const buffer = integrations.find((i) => i.provider === ExternalScheduler.BUFFER) ?? null;

  const canManage = auth.member.role === MemberRole.OWNER || auth.member.role === MemberRole.ADMIN;

  return (
    <div
      className="flex flex-col"
      style={{ gap: 16, maxWidth: 920, fontFamily: "var(--font-revamp-sans)" }}
    >
      {sp.buffer === "connected" ? (
        <StatusBanner tone="success">
          Buffer connected. Approved posts on Twitter, LinkedIn, Instagram, and TikTok can now be
          scheduled through Buffer.
        </StatusBanner>
      ) : null}
      {sp.buffer === "disconnected" ? (
        <StatusBanner tone="warning">
          Buffer disconnected. In-flight scheduled posts have been downgraded to manual — verify
          them on Buffer&apos;s side.
        </StatusBanner>
      ) : null}
      {sp.error ? (
        <StatusBanner tone="error">
          {BUFFER_ERROR_COPY[sp.error] ?? BUFFER_ERROR_COPY.unknown}
        </StatusBanner>
      ) : null}

      <BufferIntegrationCard integration={buffer} canManage={canManage} />

      {/* Roadmap */}
      <div
        style={{
          background: "#ffffff",
          border: `1px solid ${CARD_BORDER}`,
          borderRadius: 12,
          padding: "24px 28px",
        }}
      >
        <div className="flex items-baseline justify-between">
          <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>On the roadmap</div>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: ACCENT,
              cursor: "pointer",
            }}
          >
            Request an integration →
          </span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 16 }}>
          <RoadmapCard
            icon="T"
            label="Typefully"
            desc="Thread drafting with Typefully-style previews before posts go out."
          />
          <RoadmapCard
            icon="⤴"
            label="Native publishing"
            desc="First-party publishing to Twitter, LinkedIn, Instagram, and TikTok — no middleman. Buffer covers the same four today."
          />
        </div>
      </div>
    </div>
  );
}

function StatusBanner({
  tone,
  children,
}: {
  tone: "success" | "warning" | "error";
  children: React.ReactNode;
}) {
  const styles =
    tone === "success"
      ? { bg: "#E6F1EA", border: "#B8DBC5", fg: "#1E5A34" }
      : tone === "warning"
        ? { bg: "#FBF1DE", border: "#E6D9B8", fg: "#7A5410" }
        : { bg: "#FBE7E4", border: "#E4C5C5", fg: "#8A2A1F" };

  return (
    <div
      style={{
        background: styles.bg,
        border: `1px solid ${styles.border}`,
        color: styles.fg,
        borderRadius: 10,
        padding: "10px 14px",
        fontSize: 13,
      }}
    >
      {children}
    </div>
  );
}

function RoadmapCard({ icon, label, desc }: { icon: string; label: string; desc: string }) {
  return (
    <div
      style={{
        border: `1px dashed ${OUTLINE_STRONG}`,
        background: "#fbfcfe",
        borderRadius: 10,
        padding: "18px 20px",
      }}
    >
      <div className="flex items-center" style={{ gap: 10 }}>
        <div
          className="grid flex-shrink-0 place-items-center"
          style={{
            width: 34,
            height: 34,
            borderRadius: 9,
            background: "#f1f4f9",
            color: LIGHT_MUTED,
            fontWeight: 800,
            fontSize: 14,
          }}
        >
          {icon}
        </div>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: MUTED }}>{label}</span>
        <span
          className="ml-auto"
          style={{
            fontFamily: "var(--font-revamp-mono)",
            fontSize: 9.5,
            letterSpacing: "0.1em",
            color: LIGHT_MUTED,
            background: "#f1f4f9",
            padding: "3px 8px",
            borderRadius: 99,
            fontWeight: 600,
          }}
        >
          COMING SOON
        </span>
      </div>
      <div style={{ fontSize: 12.5, color: LIGHT_MUTED, lineHeight: 1.55, marginTop: 10 }}>
        {desc}
      </div>
    </div>
  );
}

const BUFFER_ERROR_COPY: Record<string, string> = {
  missing_code: "Buffer didn't return an authorization code — try connecting again.",
  bad_state: "Security check failed on the OAuth callback. Try the flow again.",
  token_exchange_failed:
    "Buffer rejected the authorization code. It may have already been used — try again.",
  missing_encryption_key:
    "INTEGRATION_ENCRYPTION_KEY isn't set on this environment. Add it to .env.local and restart the dev server.",
  missing_verifier:
    "PKCE verifier cookie was missing on the OAuth return — try connecting again from the same browser tab.",
  missing_buffer_client_id:
    "BUFFER_CLIENT_ID isn't set. Create a Buffer OAuth app at https://buffer.com/developers/apps and add the Client ID to .env.local.",
  missing_buffer_client_secret:
    "BUFFER_CLIENT_SECRET isn't set. Copy the Client Secret from your Buffer OAuth app into .env.local.",
  token_vault_unavailable:
    "The integration encryption key isn't configured on this environment. Contact support.",
  unknown: "Something went wrong connecting Buffer. Try again or reach out to support.",
};
