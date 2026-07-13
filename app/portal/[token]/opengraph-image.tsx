import { ImageResponse } from "next/og";
import { getPortalLinkByToken } from "@/server/db/client-portal";
import { prisma } from "@/server/db/client";

/**
 * Client-portal OG card.
 *
 * A portal URL is a one-time delivery link that agencies share with
 * their clients — the OG here shows the agency's brand + the client's
 * name + a short "N approved deliverables ready" line so a preview in
 * Slack, iMessage, or email doesn't collapse to a generic Repodcast
 * card.
 *
 * The token IS the credential — same shape as the portal route itself.
 * Invalid / revoked / expired links get a neutral fallback so no signal
 * about the token's state leaks out of the OG endpoint.
 *
 * Runtime is Node (not Edge) because we need Prisma to resolve the
 * token → agency → deliverable-count. Rendered on-demand and cached
 * by Next's OG-cache layer.
 */
export const alt = "Client delivery portal — Repodcast";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#1A2A4A";
const DEEP = "#13203B";
const MINT = "#7FE3B0";
const MUTED = "#A9B6D4";

export default async function PortalOpenGraphImage({ params }: { params: { token: string } }) {
  const link = await safeLookup(params.token);
  if (!link) return fallback();

  const approvedCount = await safeCountApproved(link.clientId);
  const brandLogo = link.client.agency.brandLogoUrl;
  const brandAccent = link.client.agency.brandAccentColor ?? MINT;
  const agencyName = link.client.agency.name;
  const clientName = link.client.name;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: `linear-gradient(135deg, ${INK} 0%, ${DEEP} 100%)`,
        padding: 72,
        color: "#fff",
        fontFamily: "sans-serif",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)`,
          backgroundSize: "28px 28px",
        }}
      />

      {/* Agency brand row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 20,
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.01em",
        }}
      >
        {brandLogo ? (
          // Note: next/og fetches remote images at build/render time.
          // `img` here is intentional — it's satori's element, not the
          // React DOM one, so no next/image warning applies.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={brandLogo}
            alt=""
            style={{
              width: 60,
              height: 60,
              borderRadius: 12,
              objectFit: "cover",
              border: "1px solid rgba(255,255,255,0.14)",
            }}
          />
        ) : (
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 12,
              background: brandAccent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: INK,
              fontWeight: 800,
              fontSize: 22,
            }}
          >
            {agencyInitials(agencyName)}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span
            style={{
              color: MUTED,
              fontSize: 14,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Delivery portal
          </span>
          <span style={{ fontSize: 24, fontWeight: 700 }}>{truncate(agencyName, 42)}</span>
        </div>
      </div>

      {/* Client + count */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 1000 }}>
        <div
          style={{
            fontSize: 15,
            color: MUTED,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            fontWeight: 500,
          }}
        >
          Deliverables ready for
        </div>
        <div
          style={{
            fontSize: 60,
            lineHeight: 1.05,
            fontWeight: 700,
            letterSpacing: "-0.03em",
          }}
        >
          {truncate(clientName, 42)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              background: brandAccent,
              color: INK,
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            {approvedCount} approved · ready to review
          </span>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 15,
          color: MUTED,
        }}
      >
        <span>Delivered via Repodcast</span>
        <span>Token-scoped · view-only</span>
      </div>
    </div>,
    size,
  );
}

async function safeLookup(token: string) {
  try {
    return await getPortalLinkByToken(token);
  } catch {
    return null;
  }
}

async function safeCountApproved(clientId: string): Promise<number> {
  try {
    return await prisma.generatedOutput.count({
      where: {
        episode: { show: { clientId } },
        status: "APPROVED",
      },
    });
  } catch {
    return 0;
  }
}

function agencyInitials(name: string): string {
  const words = name.trim().split(/\s+/).slice(0, 2);
  return words.map((w) => w[0]?.toUpperCase() ?? "").join("");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}

function fallback() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: INK,
        color: MINT,
        fontSize: 40,
        fontWeight: 700,
      }}
    >
      Repodcast · Delivery portal
    </div>,
    size,
  );
}
