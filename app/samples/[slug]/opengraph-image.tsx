import { ImageResponse } from "next/og";
import { listSampleSlugs, resolveSample } from "@/lib/samples/registry";

/**
 * Per-sample dynamic OG card.
 *
 * Shows episode title + show name + a 4-tile "launch kit" preview strip
 * (posts / clips / artwork / audiograms). Statically generated for every
 * slug in the sample registry at build time — no runtime cost.
 *
 * `alt` + `contentType` + `size` are re-exports at module scope because
 * Next 16 reads them off the module (not the function).
 */
export const alt = "Repodcast — sample launch kit";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#1A2A4A";
const DEEP = "#13203B";
const MINT = "#7FE3B0";
const MUTED = "#A9B6D4";
const AMBER = "#E9CFA0";

export async function generateImageMetadata() {
  return listSampleSlugs().map((slug) => ({
    id: slug,
    contentType,
    size,
    alt,
  }));
}

export default async function SampleOpenGraphImage({ params }: { params: { slug: string } }) {
  const sample = resolveSample(params.slug);
  if (!sample) {
    // Fallback — a slug isn't in the registry (unreachable in practice
    // since `generateImageMetadata` enumerates all slugs, but Next may
    // still call this if the route was hit during dev).
    return fallback();
  }
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

      {/* Top row — brand + kit tag */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "-0.01em",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 12px",
              borderRadius: 10,
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.14)",
            }}
          >
            {[10, 18, 26, 22, 14].map((h, i) => (
              <div key={i} style={{ width: 3, height: h, background: MINT, borderRadius: 2 }} />
            ))}
          </div>
          <span>Repodcast</span>
        </div>
        <div
          style={{
            fontSize: 14,
            padding: "8px 14px",
            borderRadius: 999,
            background: "rgba(127,227,176,0.14)",
            color: MINT,
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Sample launch kit
        </div>
      </div>

      {/* Episode title + show */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 1000 }}>
        <div style={{ fontSize: 15, color: MUTED, letterSpacing: "0.06em" }}>
          {sample.show.name} · with {sample.show.host}
        </div>
        <div
          style={{
            fontSize: 52,
            lineHeight: 1.06,
            fontWeight: 700,
            letterSpacing: "-0.03em",
          }}
        >
          {truncate(sample.episodeTitle, 68)}
        </div>
      </div>

      {/* Kit strip */}
      <div style={{ display: "flex", gap: 16 }}>
        <KitTile label="7 posts" tone="mint" />
        <KitTile label="3 clips · 9:16" tone="dark" />
        <KitTile label="Artwork · 3 aspects" tone="amber" />
        <KitTile label="3 audiograms" tone="dark" />
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
        <span>repodcastapp.com/samples/{params.slug}</span>
        <span>One episode · one voice</span>
      </div>
    </div>,
    size,
  );
}

function KitTile({ label, tone }: { label: string; tone: "mint" | "amber" | "dark" }) {
  const bg =
    tone === "mint"
      ? "rgba(127,227,176,0.18)"
      : tone === "amber"
        ? "rgba(233,207,160,0.16)"
        : "rgba(255,255,255,0.06)";
  const color = tone === "mint" ? MINT : tone === "amber" ? AMBER : "#fff";
  const border =
    tone === "mint"
      ? "1px solid rgba(127,227,176,0.35)"
      : tone === "amber"
        ? "1px solid rgba(233,207,160,0.3)"
        : "1px solid rgba(255,255,255,0.14)";
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "18px 20px",
        borderRadius: 14,
        background: bg,
        border,
        color,
        fontSize: 20,
        fontWeight: 700,
        letterSpacing: "-0.01em",
      }}
    >
      {label}
    </div>
  );
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
      Sample not found
    </div>,
    size,
  );
}
