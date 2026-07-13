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
      <RegenExplainer />
      <PlanComparisonTable />
      <GuaranteeStrip />
      <PricingFAQ />
      <PricingFinalCTA isSignedIn={isSignedIn} />
    </>
  );
}

/* ============================================================
   Regeneration microcopy — the "first render is always free"
   explainer per PricingV2 §6. Sits between the picker and the
   full comparison table so buyers who see "40 regenerations /
   month" don't confuse it with a total-clips ceiling.
   ============================================================ */

function RegenExplainer() {
  return (
    <section
      className="px-5 py-10 sm:px-7 sm:py-12 md:py-[56px]"
      style={{ background: "#FFFFFF", borderBottom: "1px solid #ECEEF3" }}
    >
      <div
        className="mx-auto rounded-[14px] px-6 py-6 sm:px-8 sm:py-7 md:px-10 md:py-8"
        style={{
          maxWidth: 940,
          background: "#F6F8FC",
          border: "1px solid #E4E9F1",
        }}
      >
        <div
          className="mb-3 text-[11px] font-semibold uppercase sm:mb-[14px] sm:text-[12px]"
          style={{
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.14em",
            color: "#3A5BA0",
          }}
        >
          What counts as a regeneration?
        </div>
        <p className="m-0 text-[14px] leading-[1.65] sm:text-[15px]" style={{ color: "#41506B" }}>
          The first render of every clip, artwork set, and audiogram is always included — no
          counter, no charge. Only re-runs count against your monthly regen budget: retrying a
          failed clip, trimming and re-rendering, or asking for a fresh artwork variant. Written
          posts have no regen cap at all.
        </p>
      </div>
    </section>
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
      <div className="relative mx-auto max-w-[780px] px-5 pt-12 pb-8 text-center sm:px-7 sm:pt-16 sm:pb-9 md:pt-[72px] md:pb-8">
        <div
          className="mb-[14px] text-[11px] font-medium uppercase sm:mb-[18px] sm:text-[12px]"
          style={{
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.14em",
            color: "#3A5BA0",
          }}
        >
          Simple pricing
        </div>
        <h1
          className="m-0 mb-[14px] text-[32px] leading-[1.08] sm:mb-[18px] sm:text-[40px] sm:leading-[1.07] md:text-[52px] md:leading-[1.06]"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            letterSpacing: "-0.035em",
            color: "#1A2A4A",
          }}
        >
          One plan per studio.
          <br />
          The full launch kit included.
        </h1>
        <p
          className="m-0 mx-auto max-w-[600px] text-[15px] leading-[1.6] sm:text-[17px]"
          style={{ color: "#5A6473" }}
        >
          Every plan ships seven written posts, vertical clips, hero artwork, and audiograms per
          episode — no per-render fees, no credit packs. Toggle annual to save two months. Switch or
          cancel from Settings any time.
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
      className="relative overflow-hidden px-5 py-10 sm:px-7 sm:py-14 md:py-[52px]"
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
      className="px-5 py-14 sm:px-7 sm:py-16 md:py-[68px]"
      style={{ background: "#FBFCFE", borderBottom: "1px solid #ECEEF3" }}
    >
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <div
          className="grid grid-cols-1 gap-px overflow-hidden rounded-[14px] md:grid-cols-3"
          style={{
            background: "#E8EBF1",
            border: "1px solid #E8EBF1",
          }}
        >
          {items.map((it) => (
            <div
              key={it.title}
              className="px-6 py-6 sm:px-7 sm:py-7 md:px-[28px] md:py-[30px]"
              style={{ background: "#FFFFFF" }}
            >
              <h3
                className="m-0 mb-2 text-[16px] sm:text-[17px]"
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  color: "#1A2A4A",
                  letterSpacing: "-0.015em",
                }}
              >
                {it.title}
              </h3>
              <p
                className="m-0 text-[13.5px] leading-[1.62] sm:text-[14px]"
                style={{ color: "#5A6473" }}
              >
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
      className="px-5 py-14 sm:px-7 sm:py-16 md:py-[76px]"
      style={{ background: "#FFFFFF", borderBottom: "1px solid #ECEEF3" }}
    >
      <div
        className="mx-auto grid grid-cols-1 items-start gap-8 md:grid-cols-[0.7fr_1.3fr] md:gap-14"
        style={{ maxWidth: 940 }}
      >
        <div>
          <div
            className="mb-4 text-[11px] font-medium uppercase sm:mb-5 sm:text-[12px]"
            style={{
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.14em",
              color: "#9AA3B2",
            }}
          >
            FAQ
          </div>
          <h2
            className="m-0 text-[26px] leading-[1.14] sm:text-[28px] sm:leading-[1.13] md:text-[32px] md:leading-[1.12]"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
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
    <section className="px-5 py-14 sm:px-7 sm:py-16 md:py-[68px]" style={{ background: "#1A2A4A" }}>
      <div
        className="mx-auto grid grid-cols-1 items-center gap-6 md:grid-cols-[1fr_auto] md:gap-10"
        style={{ maxWidth: 1180 }}
      >
        <div>
          <h2
            className="m-0 mb-3 text-[26px] leading-[1.12] sm:mb-[14px] sm:text-[30px] sm:leading-[1.11] md:text-[36px] md:leading-[1.1]"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              color: "#FFFFFF",
            }}
          >
            One transcript. A full launch kit.
          </h2>
          <p
            className="m-0 max-w-[560px] text-[15px] leading-[1.6] sm:text-[16px]"
            style={{ color: "#A9B6D4" }}
          >
            Pick a plan above and be shipping in your client&apos;s voice within a couple of
            minutes. Every plan carries the same deliverables — posts, clips, artwork, audiograms —
            and the same voice engine. Tiers scale volume, not what you get per episode.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isSignedIn ? (
            <Link
              href="/after-sign-in"
              className="rounded-[9px] px-5 py-3 text-[14px] font-medium whitespace-nowrap no-underline sm:px-[26px] sm:py-[14px] sm:text-[15px]"
              style={{ background: "#FFFFFF", color: "#1A2A4A" }}
            >
              Continue
            </Link>
          ) : (
            <Link
              href="/sign-up"
              className="rounded-[9px] px-5 py-3 text-[14px] font-medium whitespace-nowrap no-underline sm:px-[26px] sm:py-[14px] sm:text-[15px]"
              style={{ background: "#FFFFFF", color: "#1A2A4A" }}
            >
              Get started
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
