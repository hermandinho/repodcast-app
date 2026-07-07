import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Inter, JetBrains_Mono, Schibsted_Grotesk, Sora, Spline_Sans_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
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

export const metadata: Metadata = {
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
          <Analytics />
        </body>
      </html>
    </ClerkProvider>
  );
}
