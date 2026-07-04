import type { Metadata } from "next";
import { BrandMark } from "@/components/landing/nav";

/**
 * Coming-soon splash. Rendered when `NEXT_PUBLIC_COMING_SOON="true"` — the
 * middleware routes all non-allowlisted traffic here regardless of the
 * requested URL, so this page has to stand on its own without depending on
 * auth, DB, or API access.
 *
 * Intentionally sparse: brand lockup + a single sentence. No waitlist form,
 * no email capture, no social links — the ask is minimal so we don't have
 * to maintain a growing splash-page surface while the app is off. Flip the
 * env var back to `"false"` to expose the real app.
 */
export const metadata: Metadata = {
  title: "Coming soon — Repodcast",
  description: "Repodcast is launching soon. Check back later.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-static";

const INK = "#0a1e3c";
const MUTED = "#41506b";

export default function ComingSoonPage() {
  return (
    <main
      className="flex min-h-screen w-full flex-col items-center justify-center"
      style={{
        background: "radial-gradient(120% 80% at 100% 0%, #EEF2FB 0%, #F6F8FC 45%, #F6F8FC 100%)",
        color: INK,
        fontFamily: "var(--font-revamp-sans)",
        padding: "40px 24px",
      }}
    >
      <div className="flex flex-col items-center text-center" style={{ maxWidth: 520, gap: 24 }}>
        <BrandMark />
        <div style={{ marginTop: 8 }}>
          <p
            style={{
              fontFamily: "var(--font-revamp-mono)",
              fontSize: 11,
              letterSpacing: "0.16em",
              color: "#3A5BA0",
              fontWeight: 600,
              margin: 0,
            }}
          >
            LAUNCHING SOON
          </p>
          <h1
            style={{
              fontFamily: "var(--font-revamp-sans)",
              fontSize: 40,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1.1,
              marginTop: 14,
              marginBottom: 0,
              color: INK,
            }}
          >
            We&apos;re almost ready.
          </h1>
          <p
            style={{
              fontSize: 15,
              color: MUTED,
              marginTop: 14,
              lineHeight: 1.55,
              maxWidth: 440,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            Repodcast turns every episode into a week of client-approved social content. We&apos;re
            polishing the last few details — check back shortly.
          </p>
        </div>
      </div>
    </main>
  );
}
