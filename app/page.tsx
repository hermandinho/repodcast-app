import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { FunnelPageview } from "@/components/analytics/funnel-pageview";
import { LandingPage } from "@/components/landing/landing-page";
import { getLandingTrustedBy } from "@/lib/landing-trusted-by";

export const metadata: Metadata = {
  title: "Repodcast — A full launch kit per episode, in your show's voice.",
  description:
    "Every episode ships seven written posts, vertical clips, hero artwork, and audiograms — all in your show's voice, ready in a minute.",
  openGraph: {
    title: "Repodcast — A full launch kit per episode",
    description:
      "Seven posts, vertical clips, hero artwork, and audiograms — every episode, in your show's voice.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Repodcast — A full launch kit per episode",
  },
};

export default async function HomePage() {
  const [{ userId }, trustedBy] = await Promise.all([auth(), getLandingTrustedBy()]);
  return (
    <>
      <FunnelPageview event="landing_hero_viewed" />
      <LandingPage isSignedIn={!!userId} trustedBy={trustedBy} />
    </>
  );
}
