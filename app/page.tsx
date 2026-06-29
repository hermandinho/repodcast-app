import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { LandingPage } from "@/components/landing/landing-page";

export const metadata: Metadata = {
  title: "Repodcast — Sounds exactly like you. Gets better every episode.",
  description:
    "Turn every client episode into platform-ready content — X threads, LinkedIn posts, show notes, and more — written in your client's exact voice, in under 60 seconds.",
  openGraph: {
    title: "Repodcast — Voice-true content for podcast agencies",
    description:
      "Per-client voice models, white-label workflow, and seven formats per episode in under a minute.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Repodcast — Voice-true content for podcast agencies",
  },
};

export default async function HomePage() {
  const { userId } = await auth();
  return <LandingPage isSignedIn={!!userId} />;
}
