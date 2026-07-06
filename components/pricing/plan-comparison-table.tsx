/**
 * Full feature × plan comparison matrix — revamp visual system (see
 * `ref/UI/Revamp/`). Shared between the marketing `/pricing` page
 * (`compact = false`) and `/onboarding/plan` (`compact = true`). Data
 * lives here so both surfaces agree row-for-row.
 *
 * Key visual moves vs the classic table:
 *   - The middle (Studio / Popular) column has a persistent light-blue
 *     background (`#f2f6ff`) with thin blue side borders so the eye can
 *     follow the highlighted column top-to-bottom without hunting for
 *     the "popular" cue on each row.
 *   - Section rubrics (VOICE, OUTPUT, TEAM, CLIENT-FACING, OPS, BILLING)
 *     render as mono blue labels in a light-gray strip, replacing the
 *     old inline section rows.
 *   - `✓` cells are green (`#1f8a5b`), `—` cells are light-gray so the
 *     "included" affirmation is louder than the absence.
 *   - A sticky CTA row at the bottom mirrors the plan CTA buttons — the
 *     popular column gets the filled blue button, the others a bordered
 *     variant. On `/onboarding/plan` the CTAs anchor-scroll back to the
 *     picker (so the user can commit without hunting); on `/pricing`
 *     they link into the sign-up flow.
 */

type ComparisonRow = {
  section?: string;
  label: string;
  /** Ordered Solo, Studio, Agency, Network. */
  values: [string, string, string, string];
};

const COMPARISON: ComparisonRow[] = [
  { section: "Voice", label: "Per-client voice model", values: ["✓", "✓", "✓", "✓"] },
  { label: "Approval-driven voice learning", values: ["✓", "✓", "✓", "✓"] },
  { label: "Voice strength meter", values: ["✓", "✓", "✓", "✓"] },

  { section: "Output", label: "Formats per episode", values: ["7", "7", "7", "7"] },
  { label: "Turnaround time", values: ["< 60s", "< 60s", "< 60s", "< 60s"] },
  { label: "Batch processing", values: ["—", "—", "✓", "✓"] },
  { label: "Priority queue", values: ["—", "—", "—", "✓"] },

  { section: "Team", label: "Client shows", values: ["1", "5", "12", "25"] },
  { label: "Seats", values: ["1", "3", "6", "Unlimited"] },
  { label: "Approval workflow", values: ["✓", "✓", "✓", "✓"] },
  { label: "Role-based permissions", values: ["—", "✓", "✓", "✓"] },

  {
    section: "Client-facing",
    label: "Remove Repodcast branding",
    values: ["—", "✓", "✓", "✓"],
  },
  { label: "Branded client portal", values: ["—", "—", "✓", "✓"] },
  { label: "Custom brand accent + domain", values: ["—", "—", "—", "✓"] },

  { section: "Ops", label: "Episodes / month", values: ["20", "60", "150", "300"] },

  { section: "Billing", label: "Currencies", values: ["5", "5", "5", "5"] },
  { label: "Monthly or annual", values: ["✓", "✓", "✓", "✓"] },
  { label: "$1 activation, 7-day trial", values: ["✓", "✓", "—", "—"] },
  { label: "Cancel any time", values: ["✓", "✓", "✓", "✓"] },
];

const PLAN_NAMES = ["Solo", "Studio", "Agency", "Network"] as const;
const POPULAR_IDX = 1; // Studio

const INK = "#0a1e3c";
const ACCENT = "#3A5BA0";
const MUTED = "#41506b";
const LIGHT_MUTED = "#8a97ad";
const HL_BG = "#f2f6ff";
const HL_BORDER = "#e3edff";
const OUTLINE = "#e4e9f1";
const OUTLINE_STRONG = "#d4dbe7";
const ROW_BORDER = "#f4f6fa";
const SECTION_STRIP = "#fbfcfe";
const CHECK_GREEN = "#1f8a5b";
const DASH_GRAY = "#c9d2e0";

/** Feature label column + one column per plan (Solo, Studio, Agency, Network). */
const GRID_TEMPLATE = "2fr 1fr 1fr 1fr 1fr";
/** Minimum width the 5-col grid needs before rows start looking cramped.
 *  Below this, the parent wraps the table in a horizontal-scroll shell. */
const TABLE_MIN_WIDTH = 780;

export function PlanComparisonTable({ compact = false }: { compact?: boolean } = {}) {
  const table = <ComparisonInner compact={compact} />;

  if (compact) {
    return (
      <div className="flex flex-col" style={{ gap: 18, marginTop: 64 }}>
        <div
          className="text-center"
          style={{
            fontFamily: "var(--font-revamp-mono)",
            fontSize: 11,
            letterSpacing: "0.16em",
            color: LIGHT_MUTED,
            fontWeight: 600,
          }}
        >
          COMPARE PLANS
        </div>
        {/* Horizontal scroll on narrow viewports — the 4-column grid needs
            ~640px of horizontal room to read comfortably. */}
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-x-visible sm:px-0">
          <div style={{ minWidth: TABLE_MIN_WIDTH }}>{table}</div>
        </div>
      </div>
    );
  }

  return (
    <section
      id="compare"
      className="scroll-mt-20 px-5 py-14 sm:px-6 sm:py-16 md:px-6 md:py-[76px]"
      style={{
        background: "#f6f8fc",
        borderTop: `1px solid ${OUTLINE}`,
        fontFamily: "var(--font-revamp-sans)",
      }}
    >
      <div className="mx-auto" style={{ maxWidth: 1080 }}>
        <div className="mb-7 text-center sm:mb-8">
          <div
            style={{
              fontFamily: "var(--font-revamp-mono)",
              fontSize: 11,
              letterSpacing: "0.16em",
              color: LIGHT_MUTED,
              fontWeight: 600,
            }}
          >
            COMPARE PLANS
          </div>
          <h2
            className="mt-[10px] text-[24px] leading-[1.18] sm:text-[28px] sm:leading-[1.16] md:text-[32px] md:leading-[1.15]"
            style={{
              fontFamily: "var(--font-revamp-sans)",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              color: INK,
              margin: "10px 0 0",
            }}
          >
            What&apos;s included in each plan.
          </h2>
        </div>
        {/* 4-column grid needs ~640px to stay legible — horizontal scroll
            below that keeps rows aligned instead of column-wrapping into
            an unreadable mess. Same fallback the compact variant uses. */}
        <div className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:overflow-x-visible sm:px-0">
          <div style={{ minWidth: TABLE_MIN_WIDTH }}>{table}</div>
        </div>
      </div>
    </section>
  );
}

function ComparisonInner({ compact }: { compact: boolean }) {
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${OUTLINE}`,
        borderRadius: 14,
        overflow: "hidden",
        fontFamily: "var(--font-revamp-sans)",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID_TEMPLATE,
          borderBottom: `1px solid ${OUTLINE}`,
        }}
      >
        <div
          style={{
            padding: "16px 24px",
            fontFamily: "var(--font-revamp-mono)",
            fontSize: 11,
            letterSpacing: "0.12em",
            color: LIGHT_MUTED,
            fontWeight: 600,
          }}
        >
          FEATURE
        </div>
        {PLAN_NAMES.map((name, i) => {
          const isPopular = i === POPULAR_IDX;
          return (
            <div
              key={name}
              style={{
                padding: "16px 20px",
                fontSize: 13.5,
                fontWeight: 700,
                textAlign: "center",
                color: isPopular ? ACCENT : INK,
                background: isPopular ? HL_BG : undefined,
                borderLeft: isPopular ? `1px solid ${HL_BORDER}` : undefined,
                borderRight: isPopular ? `1px solid ${HL_BORDER}` : undefined,
              }}
            >
              {name}
              {isPopular ? (
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    background: ACCENT,
                    color: "#fff",
                    padding: "2px 7px",
                    borderRadius: 99,
                    marginLeft: 6,
                  }}
                >
                  POPULAR
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Data rows — sections rendered as strip rows before their first row. */}
      {COMPARISON.map((row, idx) => (
        <ComparisonRowView key={row.label} row={row} first={idx === 0} />
      ))}

      {/* Sticky CTA row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID_TEMPLATE,
          borderTop: `1px solid ${OUTLINE}`,
          background: SECTION_STRIP,
        }}
      >
        <div
          style={{
            padding: compact ? "14px 20px" : "16px 24px",
            fontSize: 12.5,
            color: LIGHT_MUTED,
            alignSelf: "center",
          }}
        >
          All plans include the full voice engine.
        </div>
        {PLAN_NAMES.map((name, i) => {
          const isPopular = i === POPULAR_IDX;
          // Solo (idx 0) + Studio (idx 1) get the trial CTA — matches the
          // trial-eligible plan set. Agency + Network go straight to
          // "Get started" (direct-checkout tiers). All four anchor-scroll
          // to the picker at the top of the page.
          const isTrialTier = i === 0 || i === 1;
          const label = isTrialTier ? "Start 7-day trial" : "Get started";
          return (
            <div
              key={name}
              style={{
                padding: 12,
                display: "grid",
                placeItems: "center",
                background: isPopular ? HL_BG : undefined,
                borderLeft: isPopular ? `1px solid ${HL_BORDER}` : undefined,
                borderRight: isPopular ? `1px solid ${HL_BORDER}` : undefined,
              }}
            >
              <a
                href="#top-plans"
                className="no-underline"
                style={{
                  borderRadius: 8,
                  padding: isPopular ? "9px 16px" : "8px 16px",
                  fontSize: 12.5,
                  fontWeight: 600,
                  background: isPopular ? ACCENT : "#fff",
                  color: isPopular ? "#fff" : INK,
                  border: isPopular ? "none" : `1px solid ${OUTLINE_STRONG}`,
                }}
              >
                {label}
              </a>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ComparisonRowView({ row, first }: { row: ComparisonRow; first: boolean }) {
  return (
    <>
      {row.section ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID_TEMPLATE,
            background: SECTION_STRIP,
            borderTop: first ? undefined : `1px solid ${ROW_BORDER}`,
          }}
        >
          <div
            style={{
              padding: "10px 24px",
              fontFamily: "var(--font-revamp-mono)",
              fontSize: 10,
              letterSpacing: "0.14em",
              color: ACCENT,
              fontWeight: 600,
            }}
          >
            {row.section.toUpperCase()}
          </div>
          {/* Empty placeholder cells — one per plan column so the section
              strip aligns with the row grid. The highlighted (Studio)
              column keeps its blue tint through the strip so the vertical
              band reads uninterrupted top-to-bottom. */}
          {PLAN_NAMES.map((_, i) => {
            const isPopular = i === POPULAR_IDX;
            return (
              <div
                key={i}
                style={
                  isPopular
                    ? {
                        background: HL_BG,
                        borderLeft: `1px solid ${HL_BORDER}`,
                        borderRight: `1px solid ${HL_BORDER}`,
                      }
                    : undefined
                }
              />
            );
          })}
        </div>
      ) : null}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID_TEMPLATE,
          borderTop: `1px solid ${ROW_BORDER}`,
          fontSize: 13.5,
        }}
      >
        <div style={{ padding: "12px 24px", color: MUTED }}>{row.label}</div>
        {row.values.map((v, i) => {
          const isPopular = i === POPULAR_IDX;
          return (
            <div
              key={i}
              style={{
                padding: 12,
                textAlign: "center",
                color: cellColor(v, isPopular),
                fontWeight: isPopular && !isSymbol(v) ? 600 : 400,
                background: isPopular ? HL_BG : undefined,
                borderLeft: isPopular ? `1px solid ${HL_BORDER}` : undefined,
                borderRight: isPopular ? `1px solid ${HL_BORDER}` : undefined,
              }}
            >
              {v}
            </div>
          );
        })}
      </div>
    </>
  );
}

function cellColor(value: string, isPopular: boolean): string {
  if (value === "✓") return CHECK_GREEN;
  if (value === "—") return DASH_GRAY;
  return isPopular ? INK : MUTED;
}

function isSymbol(value: string): boolean {
  return value === "✓" || value === "—";
}
