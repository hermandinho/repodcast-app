import { ImageResponse } from "next/og";

/**
 * Phase 3.1 — dynamic Open Graph image at `/opengraph-image`.
 *
 * Rendered via Next's built-in `ImageResponse` (satori under the hood)
 * instead of committing a static PNG. Same visual language as the
 * marketing surface: deep navy ink background, mint accent, Sora-
 * flavored headline.
 *
 * Twitter's summary_large_image card reuses this via
 * `app/twitter-image.tsx` (identical output).
 */
export const alt = "Repodcast — Sounds exactly like you. Gets better every episode.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Marketing tokens duplicated inline — `next/og` runs in the Edge
// runtime and can't reach `globals.css` for CSS-var resolution.
const INK = "#1A2A4A";
const DEEP = "#13203B";
const MINT = "#7FE3B0";
const MUTED = "#A9B6D4";

export default async function OpenGraphImage() {
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
      {/* Subtle dotted texture — same aesthetic as the hero. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)`,
          backgroundSize: "28px 28px",
        }}
      />

      {/* Accent orb, upper right. */}
      <div
        style={{
          position: "absolute",
          top: -140,
          right: -140,
          width: 460,
          height: 460,
          borderRadius: 9999,
          background: `radial-gradient(circle, rgba(127,227,176,0.16) 0%, rgba(127,227,176,0) 70%)`,
        }}
      />

      {/* Brand mark — top left */}
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
          {/* Waveform mark */}
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
        <span>Repodcast</span>
      </div>

      {/* Headline — center-left, hero copy verbatim so the OG matches
             the landing page's fold impression. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          maxWidth: 900,
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
          For podcast agencies
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 68,
            lineHeight: 1.05,
            fontWeight: 700,
            letterSpacing: "-0.03em",
          }}
        >
          <span>Sounds exactly like you.</span>
          <span>Gets better every episode.</span>
        </div>
        <div
          style={{
            fontSize: 22,
            lineHeight: 1.35,
            color: MUTED,
            maxWidth: 820,
          }}
        >
          Turn every client episode into platform-ready content — X threads, LinkedIn posts, show
          notes — in your client&apos;s exact voice, in under 60 seconds.
        </div>
      </div>

      {/* Footer — bottom left. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 16,
          color: MUTED,
        }}
      >
        <span>repodcast.io</span>
        <span>7 platforms · voice-true · agency-native</span>
      </div>
    </div>,
    size,
  );
}
