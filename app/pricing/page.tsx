import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { FunnelPageview } from "@/components/analytics/funnel-pageview";
import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { PricingPageBody } from "@/components/pricing/pricing-page-body";
import { PLAN_DISPLAY, PLAN_ORDER } from "@/lib/plans";

/**
 * Public pricing page — reachable from the marketing nav, from every "Get
 * Started" button on the landing, and from anywhere that deep-links a plan
 * pre-selection (e.g. ads with `?plan=STUDIO&cadence=ANNUAL`).
 *
 * Shares the sticky nav + footer with the landing so the surface reads as
 * one site. Middleware allows unauthenticated access; the picker itself is
 * a client component so cadence + currency stay interactive.
 */
export const metadata: Metadata = {
  title: "Pricing — Repodcast",
  description:
    "One plan per studio, one price. Seven posts, vertical clips, hero artwork, and audiograms per episode — everything included, no per-render fees.",
  alternates: {
    canonical: "/pricing",
  },
};

export const dynamic = "force-dynamic";

/**
 * `Product` + `Offer` JSON-LD for the pricing page. One Offer per plan,
 * priced in USD monthly — the canonical SKU. Non-USD prices exist in
 * `PLAN_PRICES_BY_CURRENCY` but expanding all 5 currencies × 2 cadences
 * to 40 Offers dilutes the "starting from $29/mo" rich-results signal
 * without helping local search (Google already localises from browser
 * geo). Annual cadence intentionally not surfaced here — the picker on
 * the page still lets buyers toggle it.
 */
function buildProductJsonLd(canonicalUrl: string): unknown {
  const offers = PLAN_ORDER.map((plan) => {
    const display = PLAN_DISPLAY[plan];
    return {
      "@type": "Offer",
      name: display.name,
      description: display.tagline,
      price: display.prices.monthly.USD.toFixed(2),
      priceCurrency: "USD",
      url: canonicalUrl,
      availability: "https://schema.org/InStock",
      category: "Subscription",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: display.prices.monthly.USD.toFixed(2),
        priceCurrency: "USD",
        billingIncrement: 1,
        unitCode: "MON",
      },
    };
  });

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Repodcast",
    description:
      "Turn every podcast episode into a full launch kit — seven platform posts, vertical clips, hero artwork, and audiograms — in your show's voice.",
    brand: { "@type": "Brand", name: "Repodcast" },
    offers,
  };
}

export default async function PricingPage() {
  const { userId } = await auth();
  const isSignedIn = !!userId;

  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://repodcastapp.com");
  const canonicalUrl = `${base.replace(/\/$/, "")}/pricing`;
  const productJsonLd = buildProductJsonLd(canonicalUrl);

  return (
    <div className="w-full overflow-x-hidden">
      <FunnelPageview event="pricing_viewed" />
      <LandingNav isSignedIn={isSignedIn} />
      <PricingPageBody isSignedIn={isSignedIn} />
      <LandingFooter />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
      />
    </div>
  );
}
