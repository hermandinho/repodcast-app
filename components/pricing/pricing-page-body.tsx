import Link from "next/link";
import { FAQAccordion } from "@/components/landing/faq-accordion";
import { PlanComparisonTable } from "@/components/pricing/plan-comparison-table";
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
      <PlanComparisonTable />
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
