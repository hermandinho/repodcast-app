/**
 * Full feature × plan comparison matrix. Shared between the marketing
 * `/pricing` page (default variant, wrapped in a section band) and
 * `/onboarding/plan` (compact variant, embedded inside the 720px form
 * column). Data lives here so both surfaces agree row-for-row.
 */

type ComparisonRow = {
  section?: string;
  label: string;
  values: [string, string, string];
  emphasis?: boolean;
};

const COMPARISON: ComparisonRow[] = [
  { section: "Voice", label: "Per-client voice model", values: ["✓", "✓", "✓"] },
  { label: "Approval-driven voice learning", values: ["✓", "✓", "✓"] },
  { label: "Voice strength meter", values: ["✓", "✓", "✓"] },

  { section: "Output", label: "Formats per episode", values: ["7", "7", "7"] },
  { label: "Turnaround time", values: ["< 60s", "< 60s", "< 60s"] },
  { label: "Batch processing", values: ["—", "—", "✓"], emphasis: true },

  { section: "Team", label: "Client shows", values: ["3", "10", "25"] },
  { label: "Seats", values: ["2", "6", "Unlimited"] },
  { label: "Approval workflow", values: ["✓", "✓", "✓"] },
  { label: "Role-based permissions", values: ["✓", "✓", "✓"] },

  {
    section: "Client-facing",
    label: "White-label exports",
    values: ["—", "✓", "✓"],
    emphasis: true,
  },
  { label: "Client portal (per-client)", values: ["—", "✓", "✓"], emphasis: true },
  { label: "Custom brand accent", values: ["—", "✓", "✓"] },

  { section: "Ops", label: "Monthly cost cap", values: ["$20", "$60", "$200"] },
  { label: "Episodes / month", values: ["20", "60", "200"] },
  { label: "Generations / month", values: ["140", "420", "1,400"] },

  { section: "Billing", label: "Currencies", values: ["5", "5", "5"] },
  { label: "Monthly or annual", values: ["✓", "✓", "✓"] },
  { label: "Cancel any time", values: ["✓", "✓", "✓"] },
];

/**
 * `compact = false` is the marketing variant used on `/pricing` — includes
 * the outer `<section>` band with heading. `compact = true` drops the section
 * wrapper + heading and shrinks type/padding so the table fits inside the
 * 720px onboarding column.
 */
export function PlanComparisonTable({ compact = false }: { compact?: boolean } = {}) {
  const planNames = ["Studio", "Agency", "Network"] as const;

  // Group rows by section for the sticky section headers.
  const groups: Array<{ title: string; rows: ComparisonRow[] }> = [];
  let current: { title: string; rows: ComparisonRow[] } | null = null;
  for (const row of COMPARISON) {
    if (row.section) {
      if (current) groups.push(current);
      current = { title: row.section, rows: [row] };
    } else if (current) {
      current.rows.push(row);
    }
  }
  if (current) groups.push(current);

  const headerPad = compact ? "14px 14px" : "18px 22px";
  const cellPad = compact ? "11px 14px" : "14px 22px";
  const cellValuePad = compact ? "11px 12px" : "14px 20px";
  const groupHeaderPad = compact ? "13px 14px 5px" : "16px 22px 6px";
  const fontSize = compact ? 13 : 14;
  const cellFontSize = compact ? 12.5 : 12.5;

  const table = (
    <div
      className="overflow-hidden"
      style={{ border: "1px solid #E4E8F0", borderRadius: 14, background: "#FFFFFF" }}
    >
      <div
        className="grid font-semibold uppercase"
        style={{
          gridTemplateColumns: "1.4fr repeat(3,1fr)",
          background: "#F5F7FB",
          borderBottom: "1px solid #E8EBF1",
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.06em",
          color: "#5A6473",
          fontSize: cellFontSize,
        }}
      >
        <div style={{ padding: headerPad }}>Feature</div>
        {planNames.map((name, i) => (
          <div
            key={name}
            style={{
              padding: headerPad,
              borderLeft: "1px solid #E8EBF1",
              color: i === 1 ? "#1A2A4A" : undefined,
              background: i === 1 ? "#FFFFFF" : undefined,
            }}
          >
            {name}
            {i === 1 && (
              <span
                className="ml-2 rounded-md"
                style={{
                  padding: "2px 6px",
                  background: "#7FE3B0",
                  color: "#1A2A4A",
                  fontSize: compact ? 9.5 : 10.5,
                }}
              >
                Popular
              </span>
            )}
          </div>
        ))}
      </div>

      {groups.map((group, gi) => (
        <div key={group.title}>
          <div
            className="font-medium uppercase"
            style={{
              padding: groupHeaderPad,
              color: "#3A5BA0",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.08em",
              background: gi === 0 ? "transparent" : "#FBFCFE",
              borderTop: gi === 0 ? "none" : "1px solid #EEF0F5",
              fontSize: compact ? 10.5 : 11.5,
            }}
          >
            {group.title}
          </div>
          {group.rows.map((row) => (
            <div
              key={row.label}
              className="grid"
              style={{
                gridTemplateColumns: "1.4fr repeat(3,1fr)",
                borderTop: "1px solid #F0F2F6",
                background: row.emphasis ? "#F9FBFD" : undefined,
              }}
            >
              <div
                style={{
                  padding: cellPad,
                  color: "#1A2A4A",
                  fontSize,
                  fontWeight: 500,
                }}
              >
                {row.label}
              </div>
              {row.values.map((v, i) => (
                <div
                  key={i}
                  style={{
                    padding: cellValuePad,
                    borderLeft: "1px solid #F0F2F6",
                    color: i === 1 ? "#1A2A4A" : "#5A6473",
                    background: i === 1 ? "#F1F6FF" : undefined,
                    fontSize,
                    fontWeight: i === 1 ? 600 : 400,
                  }}
                >
                  {v}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );

  if (compact) {
    return (
      <div className="flex flex-col gap-4">
        <div className="text-center">
          <div
            className="text-[11px] font-medium uppercase"
            style={{
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.12em",
              color: "#9AA3B2",
            }}
          >
            Compare plans
          </div>
        </div>
        {/* Horizontal scroll on narrow viewports — the 4-column grid needs
            ~480px of horizontal room to read comfortably; anything smaller
            gets a scroll gutter with `-webkit-overflow-scrolling: touch`
            so momentum-scroll feels native on iOS. */}
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-x-visible sm:px-0">
          <div className="min-w-[480px]">{table}</div>
        </div>
      </div>
    );
  }

  return (
    <section
      id="compare"
      className="scroll-mt-20 px-7 py-[76px]"
      style={{ background: "#FFFFFF", borderBottom: "1px solid #ECEEF3" }}
    >
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <div className="mb-9 text-center">
          <div
            className="text-[12px] font-medium uppercase"
            style={{
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.14em",
              color: "#9AA3B2",
            }}
          >
            Full comparison
          </div>
          <h2
            className="m-0 mt-3"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 32,
              lineHeight: 1.15,
              letterSpacing: "-0.03em",
              color: "#1A2A4A",
            }}
          >
            What&apos;s included in each plan.
          </h2>
        </div>
        {table}
      </div>
    </section>
  );
}
