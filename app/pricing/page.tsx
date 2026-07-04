import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { PricingPageBody } from "@/components/pricing/pricing-page-body";

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
    "Simple, honest pricing for podcast agencies. Monthly or annual (two months free), five currencies, no hidden tiers.",
};

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const { userId } = await auth();
  const isSignedIn = !!userId;

  return (
    <div className="w-full overflow-x-hidden">
      <LandingNav isSignedIn={isSignedIn} />
      <PricingPageBody isSignedIn={isSignedIn} />
      <LandingFooter />
    </div>
  );
}
