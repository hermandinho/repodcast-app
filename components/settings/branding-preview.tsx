const INK = "#0a1e3c";
const MUTED = "#41506b";
const LIGHT_MUTED = "#8a97ad";
const CARD_BORDER = "#e4e9f1";
const ROW_BORDER = "#eef1f6";
const ACCENT = "#3A5BA0";
const ACCENT_SOFT = "#eef2fb";

/**
 * Miniature client-portal mock rendered inside the
 * `<FeatureUpgradePrompt>` right column on `/settings/branding` when the
 * plan doesn't unlock white-label. Deliberately smaller and less
 * interactive than the live preview inside `<BrandingForm>` — the buyer
 * is looking at what they'd get, not editing it. Uses the same visual
 * grammar so upgrading feels continuous.
 */
export function WhiteLabelPreview({ agencyName }: { agencyName: string }) {
  return (
    <div
      style={{
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 12,
        overflow: "hidden",
        background: "#fff",
        boxShadow: "0 10px 30px -18px rgba(10,30,60,0.24)",
      }}
    >
      <div
        className="flex items-center"
        style={{
          gap: 8,
          background: "#f1f4f9",
          borderBottom: `1px solid ${CARD_BORDER}`,
          padding: "8px 12px",
        }}
      >
        <div className="flex" style={{ gap: 4 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 7, height: 7, borderRadius: 99, background: "#dfe5ee" }} />
          ))}
        </div>
        <div
          className="flex-1"
          style={{
            background: "#fff",
            border: `1px solid ${CARD_BORDER}`,
            borderRadius: 5,
            padding: "3px 10px",
            fontFamily: "var(--font-revamp-mono)",
            fontSize: 10,
            color: LIGHT_MUTED,
          }}
        >
          portal.repodcast.app/{slugify(agencyName)}
        </div>
      </div>

      <div
        className="flex items-center"
        style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${ROW_BORDER}`,
          gap: 10,
        }}
      >
        <div
          className="grid place-items-center"
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: ACCENT_SOFT,
            color: ACCENT,
            fontSize: 11,
            fontWeight: 800,
          }}
        >
          {initialsOf(agencyName)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{agencyName}</div>
          <div style={{ fontSize: 10.5, color: LIGHT_MUTED }}>Client portal</div>
        </div>
      </div>

      <div style={{ padding: "14px 16px" }}>
        <div
          style={{
            fontFamily: "var(--font-revamp-mono)",
            fontSize: 9.5,
            letterSpacing: "0.08em",
            color: LIGHT_MUTED,
            marginBottom: 6,
          }}
        >
          EP 41 · LINKEDIN POST
        </div>
        <div style={{ fontSize: 11.5, lineHeight: 1.55, color: MUTED, marginBottom: 10 }}>
          Most founders don&apos;t have a growth problem. They have a focus problem.
        </div>
        <div className="flex" style={{ gap: 6 }}>
          <span
            style={{
              background: ACCENT,
              color: "#fff",
              fontSize: 10.5,
              fontWeight: 600,
              padding: "5px 11px",
              borderRadius: 6,
            }}
          >
            Approve
          </span>
          <span
            style={{
              border: `1px solid ${CARD_BORDER}`,
              color: MUTED,
              fontSize: 10.5,
              fontWeight: 600,
              padding: "5px 11px",
              borderRadius: 6,
            }}
          >
            Request changes
          </span>
        </div>
      </div>
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40);
}
