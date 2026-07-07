import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Inter, JetBrains_Mono, Schibsted_Grotesk, Sora, Spline_Sans_Mono } from "next/font/google";
import { AnalyticsWithFilter } from "@/components/providers/analytics";
import { ConsentBanner } from "@/components/consent/consent-banner";
import { PostHogProvider } from "@/components/providers/posthog-provider";
import { clerkAppearance } from "@/lib/clerk-appearance";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
});

// Revamp fonts — used on `/onboarding/*` (and rolling out to Settings +
// Landing next). Existing Sora/Inter/JetBrains Mono stay as the app-wide
// defaults until we finish the migration. See MarketingStrategy.md and
// the ref UI in `ref/UI/Revamp/`.
const schibstedGrotesk = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700", "800", "900"],
});

const splineSansMono = Spline_Sans_Mono({
  variable: "--font-spline-mono",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
});

/**
 * Absolute origin every generated `og:image` / `twitter:image` URL is
 * resolved against. Without this, Next.js falls back to `VERCEL_URL` on
 * Vercel deployments — which, on preview builds, is the ugly
 * `<project>-git-<branch>-<user>-projects.vercel.app` host that ends up
 * baked into shared links until the crawler re-fetches. The same
 * fallback chain the sitemap + robots routes use so all three surfaces
 * agree on the canonical origin.
 */
const metadataBase = new URL(
  process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://repodcastapp.com"),
);

export const metadata: Metadata = {
  metadataBase,
  title: "Repodcast",
  description: "Turn podcast episodes into platform-ready content in your client's voice.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider appearance={clerkAppearance} afterSignOutUrl="/">
      <html
        lang="en"
        className={`${inter.variable} ${sora.variable} ${jetBrainsMono.variable} ${schibstedGrotesk.variable} ${splineSansMono.variable} h-full`}
      >
        <body className="min-h-full">
          <PostHogProvider>{children}</PostHogProvider>
          <ConsentBanner />
          <AnalyticsWithFilter />
        </body>
      </html>
    </ClerkProvider>
  );
}
