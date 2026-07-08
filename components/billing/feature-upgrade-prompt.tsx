import Link from "next/link";
import { featureFor, requiredPlanNameFor, type PlanFeatureKey } from "@/lib/plan-features";

const INK = "#0a1e3c";
const MUTED = "#41506b";
const CARD_BORDER = "#e4e9f1";
const ROW_BORDER = "#eef1f6";
const ACCENT = "#3A5BA0";
const ACCENT_SOFT = "#eef2fb";

/**
 * Shared upsell card rendered on any surface a feature is gated behind a
 * higher plan. Reads copy + minimum plan from `PLAN_FEATURES` so the
 * server-side `assertMinPlan` gate and this UI never drift.
 *
 * Two visual modes:
 *   - `size="lg"` (default) — full card with heading, highlights bullet
 *     list, and side-by-side CTA row. Use as a page-level replacement
 *     when the whole surface is locked (see `/settings/branding` on
 *     Solo/Studio).
 *   - `size="sm"` — compact inline banner. Use when nesting inside a
 *     form section that is partially unlocked (e.g. the NETWORK-only
 *     accent picker inside the AGENCY branding form).
 *
 * `preview` is an optional right-column slot for a screenshot / mock so
 * the buyer sees what they're upgrading into. Only rendered in `lg` mode.
 */
export function FeatureUpgradePrompt({
  feature,
  size = "lg",
  preview,
  className,
}: {
  feature: PlanFeatureKey;
  size?: "lg" | "sm";
  preview?: React.ReactNode;
  className?: string;
}) {
  const cfg = featureFor(feature);
  const planName = requiredPlanNameFor(feature);

  if (size === "sm") {
    return <CompactPrompt cfg={cfg} planName={planName} className={className} />;
  }
  return <FullPrompt cfg={cfg} planName={planName} preview={preview} className={className} />;
}

function FullPrompt({
  cfg,
  planName,
  preview,
  className,
}: {
  cfg: ReturnType<typeof featureFor>;
  planName: string;
  preview?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        background: "#ffffff",
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 16px 40px -22px rgba(10,30,60,0.16)",
        fontFamily: "var(--font-revamp-sans)",
      }}
    >
      <div
        className="grid"
        style={{
          gridTemplateColumns: preview ? "1fr 1fr" : "1fr",
          alignItems: "stretch",
        }}
      >
        {/* Left column — copy + CTA */}
        <div style={{ padding: "28px 30px" }}>
          <div className="flex items-center" style={{ gap: 8, marginBottom: 14 }}>
            <LockGlyph />
            <span
              style={{
                fontFamily: "var(--font-revamp-mono)",
                fontSize: 10,
                letterSpacing: "0.14em",
                color: ACCENT,
                background: ACCENT_SOFT,
                padding: "3px 9px",
                borderRadius: 99,
                fontWeight: 600,
                textTransform: "uppercase",
              }}
            >
              {planName} plan
            </span>
          </div>

          <h2
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: INK,
              margin: 0,
              lineHeight: 1.2,
              letterSpacing: "-0.01em",
            }}
          >
            {cfg.title} unlocks on {planName}.
          </h2>
          <p
            style={{
              fontSize: 13.5,
              lineHeight: 1.6,
              color: MUTED,
              marginTop: 10,
              marginBottom: 18,
              maxWidth: 480,
            }}
          >
            {cfg.description}
          </p>

          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {cfg.highlights.map((h) => (
              <li
                key={h}
                className="flex items-start"
                style={{
                  gap: 10,
                  fontSize: 13,
                  color: MUTED,
                  padding: "6px 0",
                  lineHeight: 1.5,
                }}
              >
                <CheckGlyph />
                <span>{h}</span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center" style={{ gap: 10, marginTop: 22 }}>
            <Link
              href="/settings/billing"
              className="no-underline"
              style={{
                background: ACCENT,
                color: "#fff",
                borderRadius: 8,
                padding: "10px 18px",
                fontSize: 13.5,
                fontWeight: 600,
              }}
            >
              Upgrade to {planName}
            </Link>
            <Link
              href="/pricing"
              className="no-underline"
              style={{
                color: MUTED,
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 13.5,
                fontWeight: 600,
                border: `1px solid ${CARD_BORDER}`,
                background: "#fff",
              }}
            >
              Compare plans →
            </Link>
          </div>
        </div>

        {/* Right column — optional preview */}
        {preview ? (
          <div
            style={{
              background: "linear-gradient(140deg, #f6f8fc 0%, #eef2fb 100%)",
              borderLeft: `1px solid ${ROW_BORDER}`,
              padding: "28px 30px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ width: "100%" }}>{preview}</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CompactPrompt({
  cfg,
  planName,
  className,
}: {
  cfg: ReturnType<typeof featureFor>;
  planName: string;
  className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        background: ACCENT_SOFT,
        border: `1px solid #d9e0f0`,
        borderRadius: 10,
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        fontFamily: "var(--font-revamp-sans)",
      }}
    >
      <LockGlyph />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: INK, lineHeight: 1.3 }}>
          {cfg.title} unlocks on {planName}.
        </div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 2, lineHeight: 1.45 }}>
          {cfg.description}
        </div>
      </div>
      <Link
        href="/settings/billing"
        className="no-underline"
        style={{
          background: ACCENT,
          color: "#fff",
          borderRadius: 7,
          padding: "7px 13px",
          fontSize: 12.5,
          fontWeight: 600,
          flexShrink: 0,
        }}
      >
        Upgrade
      </Link>
    </div>
  );
}

function LockGlyph() {
  return (
    <span
      aria-hidden
      className="grid place-items-center"
      style={{
        width: 22,
        height: 22,
        borderRadius: 6,
        background: ACCENT_SOFT,
        color: ACCENT,
        flexShrink: 0,
      }}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
        <rect x="3" y="7" width="10" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M5.5 7V5a2.5 2.5 0 015 0v2"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

function CheckGlyph() {
  return (
    <span
      aria-hidden
      className="grid place-items-center"
      style={{
        width: 18,
        height: 18,
        borderRadius: 99,
        background: ACCENT_SOFT,
        color: ACCENT,
        flexShrink: 0,
        marginTop: 1,
      }}
    >
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path
          d="M2.5 6.5L5 9L9.5 3.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
