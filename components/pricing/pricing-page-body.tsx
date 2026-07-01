import Link from "next/link";
import { FAQAccordion } from "@/components/landing/faq-accordion";
import { PricingPicker } from "@/components/pricing/pricing-picker";

/**
 * Body of the /pricing page — hero, picker, comparison table, guarantee
 * strip, FAQ. Rendered inside the shared LandingNav + LandingFooter chrome
 * from `app/pricing/page.tsx`. Server component; the picker itself opts
 * into `"use client"` internally.
 */
export function PricingPageBody({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <>
      <PricingHero />
      <PricingPickerSection />
      <ComparisonTable />
      <GuaranteeStrip />
      <PricingFAQ />
      <PricingFinalCTA isSignedIn={isSignedIn} />
    </>
  );
}

/* ============================================================
   Hero
   ============================================================ */

function PricingHero() {
  return (
    <section
      className="relative overflow-hidden"
      style={{
        background: "linear-gradient(180deg,#FFFFFF 0%,#FBFCFE 100%)",
        borderBottom: "1px solid #ECEEF3",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          top: "-160px",
          right: "-120px",
          width: 520,
          height: 520,
          borderRadius: "50%",
          background: "radial-gradient(circle,rgba(58,91,160,0.10) 0%,rgba(58,91,160,0) 70%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(#1A2A4A 0.8px, transparent 0.8px)",
          backgroundSize: "24px 24px",
          opacity: 0.035,
        }}
      />
      <div
        className="relative mx-auto px-7 text-center"
        style={{ maxWidth: 780, paddingTop: 72, paddingBottom: 32 }}
      >
        <div
          className="mb-[18px] text-[12px] font-medium uppercase"
          style={{
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.14em",
            color: "#3A5BA0",
          }}
        >
          Simple pricing
        </div>
        <h1
          className="m-0"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 52,
            lineHeight: 1.06,
            letterSpacing: "-0.035em",
            color: "#1A2A4A",
            marginBottom: 18,
          }}
        >
          Priced per studio,
          <br />
          not per post.
        </h1>
        <p
          className="m-0 mx-auto"
          style={{
            fontSize: "17px",
            lineHeight: 1.6,
            color: "#5A6473",
            maxWidth: 560,
          }}
        >
          Pick a plan that fits your studio. Toggle annual to save two months. Everything switches
          or cancels from Settings — no calls, no forms.
        </p>
      </div>
    </section>
  );
}

/* ============================================================
   Picker section
   ============================================================ */

function PricingPickerSection() {
  return (
    <section
      className="relative overflow-hidden px-7 py-[52px]"
      style={{ background: "#FBFCFE", borderBottom: "1px solid #ECEEF3" }}
    >
      <div className="relative mx-auto" style={{ maxWidth: 1180 }}>
        <PricingPicker />
      </div>
    </section>
  );
}

/* ============================================================
   Comparison table — full feature × plan matrix
   ============================================================ */

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

function ComparisonTable() {
  const planNames = ["Studio", "Agency", "Network"] as const;

  // Group rows by section so we can render sticky section headers.
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

  return (
    <section
      className="px-7 py-[76px]"
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

        <div
          className="overflow-hidden"
          style={{ border: "1px solid #E4E8F0", borderRadius: 16, background: "#FFFFFF" }}
        >
          <div
            className="grid text-[12.5px] font-semibold uppercase"
            style={{
              gridTemplateColumns: "1.6fr repeat(3,1fr)",
              background: "#F5F7FB",
              borderBottom: "1px solid #E8EBF1",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.06em",
              color: "#5A6473",
            }}
          >
            <div style={{ padding: "18px 22px" }}>Feature</div>
            {planNames.map((name, i) => (
              <div
                key={name}
                style={{
                  padding: "18px 20px",
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
                      padding: "3px 8px",
                      background: "#7FE3B0",
                      color: "#1A2A4A",
                      fontSize: 10.5,
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
                className="text-[11.5px] font-medium uppercase"
                style={{
                  padding: "16px 22px 6px",
                  color: "#3A5BA0",
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.08em",
                  background: gi === 0 ? "transparent" : "#FBFCFE",
                  borderTop: gi === 0 ? "none" : "1px solid #EEF0F5",
                }}
              >
                {group.title}
              </div>
              {group.rows.map((row) => (
                <div
                  key={row.label}
                  className="grid"
                  style={{
                    gridTemplateColumns: "1.6fr repeat(3,1fr)",
                    borderTop: "1px solid #F0F2F6",
                    background: row.emphasis ? "#F9FBFD" : undefined,
                  }}
                >
                  <div
                    style={{
                      padding: "14px 22px",
                      color: "#1A2A4A",
                      fontSize: 14,
                      fontWeight: 500,
                    }}
                  >
                    {row.label}
                  </div>
                  {row.values.map((v, i) => (
                    <div
                      key={i}
                      style={{
                        padding: "14px 20px",
                        borderLeft: "1px solid #F0F2F6",
                        color: i === 1 ? "#1A2A4A" : "#5A6473",
                        background: i === 1 ? "#F1F6FF" : undefined,
                        fontSize: 14,
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
      </div>
    </section>
  );
}

/* ============================================================
   Guarantee strip
   ============================================================ */

function GuaranteeStrip() {
  const items = [
    {
      title: "No lock-in",
      body: "Cancel or switch plans in one click from Settings. Your voice models, history, and outputs stay yours.",
    },
    {
      title: "Real invoices",
      body: "Every payment mints a proper Stripe invoice with your studio's name. Download the PDF, expense it, forget it.",
    },
    {
      title: "Currency where you bill",
      body: "USD, EUR, GBP, CAD, or AUD. Same tier, priced natively — no cross-border FX surprises.",
    },
  ];

  return (
    <section
      className="px-7 py-[68px]"
      style={{ background: "#FBFCFE", borderBottom: "1px solid #ECEEF3" }}
    >
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <div
          className="grid overflow-hidden"
          style={{
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 1,
            background: "#E8EBF1",
            border: "1px solid #E8EBF1",
            borderRadius: 14,
          }}
        >
          {items.map((it) => (
            <div key={it.title} style={{ background: "#FFFFFF", padding: "30px 28px" }}>
              <h3
                className="m-0"
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  fontSize: 17,
                  color: "#1A2A4A",
                  marginBottom: 8,
                  letterSpacing: "-0.015em",
                }}
              >
                {it.title}
              </h3>
              <p className="m-0" style={{ fontSize: 14, lineHeight: 1.62, color: "#5A6473" }}>
                {it.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   FAQ
   ============================================================ */

function PricingFAQ() {
  return (
    <section
      className="px-7 py-[76px]"
      style={{ background: "#FFFFFF", borderBottom: "1px solid #ECEEF3" }}
    >
      <div
        className="mx-auto grid items-start gap-14"
        style={{ maxWidth: 940, gridTemplateColumns: "0.7fr 1.3fr" }}
      >
        <div>
          <div
            className="mb-5 text-[12px] font-medium uppercase"
            style={{
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.14em",
              color: "#9AA3B2",
            }}
          >
            FAQ
          </div>
          <h2
            className="m-0"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 32,
              lineHeight: 1.12,
              letterSpacing: "-0.03em",
              color: "#1A2A4A",
            }}
          >
            Answers before you click.
          </h2>
        </div>
        <FAQAccordion />
      </div>
    </section>
  );
}

/* ============================================================
   Final CTA (dark band, matches landing)
   ============================================================ */

function PricingFinalCTA({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <section className="px-7 py-[68px]" style={{ background: "#1A2A4A" }}>
      <div
        className="mx-auto grid items-center gap-10"
        style={{ maxWidth: 1180, gridTemplateColumns: "1fr auto" }}
      >
        <div>
          <h2
            className="m-0"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 36,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              color: "#FFFFFF",
              marginBottom: 14,
            }}
          >
            One transcript. A week of content.
          </h2>
          <p
            className="m-0"
            style={{
              fontSize: 16,
              color: "#A9B6D4",
              maxWidth: 560,
              lineHeight: 1.6,
            }}
          >
            Pick a plan above and be generating in your client&apos;s voice within a couple of
            minutes. Every plan carries the same 7 formats, per-client voice engine, and approval
            workflow — the tiers scale volume, not core capability.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isSignedIn ? (
            <Link
              href="/after-sign-in"
              className="rounded-[9px] text-[15px] font-medium whitespace-nowrap no-underline"
              style={{ background: "#FFFFFF", color: "#1A2A4A", padding: "14px 26px" }}
            >
              Continue
            </Link>
          ) : (
            <Link
              href="/sign-up"
              className="rounded-[9px] text-[15px] font-medium whitespace-nowrap no-underline"
              style={{ background: "#FFFFFF", color: "#1A2A4A", padding: "14px 26px" }}
            >
              Create account
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
