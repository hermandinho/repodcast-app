import type { Metadata } from "next";
import Link from "next/link";
import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";

/**
 * Root 404 — catches every unmatched route AND any `notFound()` call
 * that doesn't hit a closer boundary (e.g. an unknown slug on
 * `/samples/[slug]`, an unreachable tenant resource that bubbles all
 * the way up). Uses the marketing chrome (LandingNav + LandingFooter)
 * so search-bot crawls and hand-typed URL misses feel like part of
 * the site, not a Vercel default.
 *
 * The copy is deliberately reassuring and short. Three CTAs:
 *   - Home (recovery)
 *   - Pricing (highest-intent forward path)
 *   - Sample delivery (curiosity path for cold traffic that landed here)
 *
 * `next/not-found` returns HTTP 404 automatically for this file.
 * `metadata.robots.noindex` prevents Google indexing typo variants.
 */

const INK = "#0A1E3C";
const MUTED = "#41506B";
const MUTED_2 = "#8A97AD";
const MINT = "#7FE3B0";
const BORDER = "#E4E9F1";

export const metadata: Metadata = {
  title: "Page not found — Repodcast",
  description: "This page moved or never existed. Here's how to get back on track.",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="w-full overflow-x-hidden bg-white">
      <LandingNav isSignedIn={false} />

      <section
        className="relative overflow-hidden px-5 py-14 text-white sm:px-8 sm:py-20 lg:px-14 lg:py-[100px]"
        style={{ background: INK }}
      >
        {/* Ambient waveform behind the copy — matches the OG image + the
            landing final-CTA's motion aesthetic. Deterministic heights
            so SSR and hydration agree. `pointer-events-none` + low
            opacity so it never fights the CTAs. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center gap-[3px] px-5 sm:gap-[5px] sm:px-8 lg:px-14"
          style={{ opacity: 0.08 }}
        >
          {WAVE_SEED.map((h, i) => (
            <span
              key={i}
              style={{
                flex: 1,
                height: 40 + h * 3.4,
                borderRadius: 2,
                background: MINT,
              }}
            />
          ))}
        </div>

        <div className="relative mx-auto text-center" style={{ maxWidth: 720 }}>
          <div
            className="mb-4 font-mono text-[11px] font-semibold uppercase sm:mb-6 sm:text-[12px]"
            style={{ letterSpacing: "0.16em", color: MINT }}
          >
            404 · Off-air
          </div>
          <h1
            className="m-0 text-[64px] leading-[1] font-extrabold sm:text-[88px] lg:text-[112px]"
            style={{
              fontFamily: "var(--font-display)",
              letterSpacing: "-0.04em",
              color: "#fff",
            }}
          >
            The signal cut out.
          </h1>
          <p
            className="m-0 mx-auto mt-6 max-w-[560px] text-[15px] leading-[1.6] sm:mt-8 sm:text-[17px]"
            style={{ color: "#A9B8D4" }}
          >
            The page you&apos;re looking for moved, was renamed, or never existed. No worries — pick
            a way back.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:mt-10">
            <Link
              href="/"
              className="rounded-[9px] px-5 py-3 text-[14px] font-semibold text-white no-underline transition-[filter] hover:brightness-110 sm:px-6 sm:py-[13px] sm:text-[15px]"
              style={{ background: "var(--color-accent)" }}
            >
              Back to home
            </Link>
            <Link
              href="/pricing"
              className="rounded-[9px] px-5 py-3 text-[14px] font-semibold no-underline sm:px-6 sm:py-[13px] sm:text-[15px]"
              style={{
                background: "rgba(255,255,255,0.08)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.18)",
              }}
            >
              See pricing
            </Link>
            <Link
              href="/samples/founders-frequency"
              className="rounded-[9px] px-5 py-3 text-[14px] font-semibold no-underline sm:px-6 sm:py-[13px] sm:text-[15px]"
              style={{
                background: "transparent",
                color: "#DBE4F5",
                border: "1px solid rgba(255,255,255,0.14)",
              }}
            >
              See a sample delivery
            </Link>
          </div>
        </div>
      </section>

      {/* Helpful-links strip — cold traffic that got here via a broken
          social link should still find a way in. Same shape as the
          landing's Problem section for visual coherence. */}
      <section
        className="px-5 py-14 sm:px-8 sm:py-16 lg:px-14 lg:py-[80px]"
        style={{ background: "#fff" }}
      >
        <div className="mx-auto" style={{ maxWidth: 940 }}>
          <div
            className="mb-6 text-center font-mono text-[11px] font-semibold uppercase sm:mb-8 sm:text-[12px]"
            style={{ letterSpacing: "0.14em", color: MUTED_2 }}
          >
            Or head somewhere useful
          </div>
          <div
            className="grid grid-cols-1 gap-px overflow-hidden rounded-[12px] sm:grid-cols-3"
            style={{ background: BORDER, border: `1px solid ${BORDER}` }}
          >
            <HelpTile
              href="/"
              title="Product tour"
              body="What Repodcast turns a podcast episode into — text, video, artwork, audio."
            />
            <HelpTile
              href="/pricing"
              title="Plans"
              body="Solo through Network. Monthly or annual. The full launch kit at every tier."
            />
            <HelpTile
              href="/contact"
              title="Contact us"
              body="Broken link, question, or looking for a real human? Email lands the same day."
            />
          </div>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}

function HelpTile({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link
      href={href}
      className="group flex flex-col justify-between gap-3 bg-white px-5 py-6 no-underline transition-colors hover:bg-[#FBFCFE] sm:px-6 sm:py-[26px]"
    >
      <div>
        <div
          className="mb-2 text-[16px] font-bold sm:text-[17px]"
          style={{
            color: INK,
            fontFamily: "var(--font-display)",
            letterSpacing: "-0.01em",
          }}
        >
          {title}
        </div>
        <p className="m-0 text-[13.5px] leading-[1.55]" style={{ color: MUTED }}>
          {body}
        </p>
      </div>
      <span
        className="text-[13px] font-semibold transition-transform group-hover:translate-x-[3px]"
        style={{ color: "var(--color-accent)" }}
      >
        Go →
      </span>
    </Link>
  );
}

/** Deterministic bar heights for the ambient waveform — same technique
 *  the landing FinalCTA uses so SSR and hydration produce identical DOM. */
const WAVE_SEED = [
  8, 16, 11, 22, 14, 28, 12, 19, 26, 10, 18, 30, 13, 24, 9, 20, 15, 27, 11, 21, 17, 29, 12, 23, 8,
  18, 25, 14, 31, 10, 19, 13, 26, 16, 9, 22, 12, 28, 15, 20, 11, 24, 8, 17, 30, 13, 21, 9, 18, 27,
];
