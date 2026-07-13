import { ImageResponse } from "next/og";

/**
 * Q2 wk15 — /pricing OG card.
 *
 * Same visual language as the global OG (dark navy + mint accent) but
 * with a compact 4-plan preview grid so shared links from the pricing
 * page communicate "there's a plan for everyone" at a glance.
 *
 * Prices are hardcoded to match `lib/plans.ts` — if the plan ladder
 * changes, update here too. `next/og` runs in the Edge runtime and
 * can't reach the plans module (Prisma types cascade in), so a small
 * duplication is the correct tradeoff.
 */
export const alt = "Repodcast pricing — one plan per studio, the full launch kit included.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#1A2A4A";
const DEEP = "#13203B";
const MINT = "#7FE3B0";
const MUTED = "#A9B6D4";

type Tier = {
  name: string;
  price: string;
  tagline: string;
  featured: boolean;
};

const TIERS: Tier[] = [
  { name: "Solo", price: "$29", tagline: "One host, one show", featured: false },
  { name: "Studio", price: "$89", tagline: "Small teams · popular", featured: true },
  { name: "Agency", price: "$179", tagline: "Client roster", featured: false },
  { name: "Network", price: "$299", tagline: "Full agency stack", featured: false },
];

export default async function PricingOpenGraphImage() {
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

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: "-0.01em",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "10px 14px",
            borderRadius: 12,
            background: "rgba(255,255,255,0.08)",
            border: "1px solid rgba(255,255,255,0.14)",
          }}
        >
          {[10, 18, 26, 22, 14].map((h, i) => (
            <div
              key={i}
              style={{
                width: 4,
                height: h,
                background: MINT,
                borderRadius: 2,
              }}
            />
          ))}
        </div>
        <span>Repodcast pricing</span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 24,
          maxWidth: 1050,
        }}
      >
        <div
          style={{
            fontSize: 18,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: MINT,
            fontWeight: 500,
          }}
        >
          One plan per studio
        </div>
        <div
          style={{
            fontSize: 52,
            lineHeight: 1.06,
            fontWeight: 700,
            letterSpacing: "-0.03em",
          }}
        >
          The full launch kit, included.
        </div>

        {/* Plan grid */}
        <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
          {TIERS.map((t) => (
            <div
              key={t.name}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "18px 18px 20px",
                borderRadius: 14,
                background: t.featured ? MINT : "rgba(255,255,255,0.06)",
                border: t.featured
                  ? "1px solid rgba(127,227,176,0.9)"
                  : "1px solid rgba(255,255,255,0.14)",
                color: t.featured ? INK : "#fff",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, opacity: t.featured ? 0.7 : 0.75 }}>
                {t.name}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  fontSize: 32,
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                }}
              >
                {t.price}
                <span style={{ fontSize: 14, fontWeight: 500, opacity: 0.65 }}>/mo</span>
              </div>
              <div style={{ fontSize: 13, opacity: t.featured ? 0.75 : 0.7 }}>{t.tagline}</div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 16,
          color: MUTED,
        }}
      >
        <span>repodcastapp.com/pricing</span>
        <span>Monthly or annual · 5 currencies · Cancel any time</span>
      </div>
    </div>,
    size,
  );
}
