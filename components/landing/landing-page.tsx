import Link from "next/link";
import { PricingPicker } from "@/components/pricing/pricing-picker";
import { DEFAULT_SOCIAL_LINKS, type LandingSocialLinks } from "@/lib/landing-social-links";
import { DEFAULT_TRUSTED_BY, type LandingTrustedBy } from "@/lib/landing-trusted-by";
import { FAQAccordion } from "./faq-accordion";
import { LandingFooter } from "./footer";
import { LandingNav } from "./nav";

/**
 * Marketing landing (revamp per ref/UI/Revamp/Landings.html option 1a
 * "Polished light — Stripe-grade refinement of the current structure").
 *
 * Section order mirrors the ref exactly: Hero (with inline product
 * mock), TrustedBy strip, Problem (heading + stat grid), HowItWorks
 * (three numbered steps), VoiceEngine (dark navy band with traits
 * card), Outputs (seven format tiles + accent chip), Pricing, FAQ,
 * FinalCTA.
 *
 * The testimonial block from the previous revision was removed — the
 * quotes were placeholder copy, and shipping invented endorsements
 * violates FTC endorsement rules. Re-add only when we have real quotes
 * from consenting studios.
 *
 * Color note: every ref accent-blue (`#2e5bff`) is intentionally mapped
 * to `var(--color-accent)` so the workspace brand color drives the page
 * instead of the ref's placeholder blue. Dark navy `#0A1E3C` is treated
 * as a neutral surface color (used for section backgrounds only) and is
 * unchanged.
 */
export function LandingPage({
  isSignedIn = false,
  trustedBy = DEFAULT_TRUSTED_BY,
  socialLinks = DEFAULT_SOCIAL_LINKS,
}: {
  isSignedIn?: boolean;
  /**
   * Managed from `/root/config` under the `LANDING_TRUSTED_BY` key.
   * Server fetch + fallback lives in `lib/landing-trusted-by.ts`; the
   * landing page itself just renders what it's given.
   */
  trustedBy?: LandingTrustedBy & { heading: string };
  /**
   * Managed from `/root/config` under the `LANDING_SOCIAL_LINKS` key.
   * Reader lives in `lib/landing-social-links.ts`. Passed through to
   * `LandingFooter`, which renders the icons (or hides the row when
   * the list is empty).
   */
  socialLinks?: LandingSocialLinks;
}) {
  return (
    <div className="w-full overflow-x-hidden bg-white">
      {/* Only surface with the #how / #voice / #faq anchors in the DOM,
          so this is the sole caller that opts into bare in-page hashes. */}
      <LandingNav isSignedIn={isSignedIn} hashLinks />
      <Hero isSignedIn={isSignedIn} />
      <TrustedBy trustedBy={trustedBy} />
      <Problem />
      <HowItWorks />
      <VideoShowcase />
      <VoiceEngine />
      <Outputs />
      <Pricing isSignedIn={isSignedIn} />
      <FAQ />
      <FinalCTA isSignedIn={isSignedIn} />
      <LandingFooter socialLinks={socialLinks} />
    </div>
  );
}

// ============================================================
// Palette + shared type ramp
// ============================================================
// Match the ref's specific ink / muted / border scales verbatim so the
// visual system stays coherent when future sections extend the file.
const INK = "#0A1E3C";
const MUTED = "#41506B";
const MUTED_2 = "#8A97AD";
const MUTED_3 = "#B0BACB";
const BORDER = "#E4E9F1";
const BORDER_SOFT = "#EEF1F6";
const CANVAS = "#F6F8FC";

// ============================================================
// Hero
// ============================================================

function Hero({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <section
      className="px-5 pt-10 pb-12 sm:px-8 sm:pt-14 sm:pb-14 lg:px-14 lg:pt-[76px] lg:pb-16"
      style={{ background: `linear-gradient(180deg,#fff 0%,${CANVAS} 100%)` }}
    >
      <div
        className="mx-auto grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14"
        style={{ maxWidth: 1180 }}
      >
        <div>
          <div
            className="mb-4 font-mono text-[11px] font-semibold uppercase sm:mb-5 sm:text-[12px]"
            style={{ letterSpacing: "0.14em", color: "var(--color-accent)" }}
          >
            For podcast agencies
          </div>
          <h1
            className="m-0 text-[34px] leading-[1.08] sm:text-[44px] sm:leading-[1.06] lg:text-[58px] lg:leading-[1.04]"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              color: INK,
            }}
          >
            Sounds exactly like you.
            <br />
            <span style={{ color: MUTED_2 }}>Gets better every episode.</span>
          </h1>
          <p
            className="m-0 mt-5 mb-7 max-w-[480px] text-[16px] leading-[1.6] sm:mt-6 sm:mb-8 sm:text-[18px]"
            style={{ color: MUTED }}
          >
            Turn every client episode into platform-ready content — X threads, LinkedIn posts, show
            notes, and more — written in your client&apos;s exact voice, in under 60 seconds.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={isSignedIn ? "/after-sign-in" : "/pricing"}
              className="rounded-[9px] px-5 py-3 text-[14px] font-semibold text-white no-underline transition-[filter] hover:brightness-110 sm:px-6 sm:py-[13px] sm:text-[15px]"
              style={{ background: INK }}
            >
              {isSignedIn ? "Continue" : "Get started"}
            </Link>
            <a
              href="#voice"
              className="rounded-[9px] px-5 py-3 text-[14px] font-semibold no-underline sm:px-[22px] sm:py-3 sm:text-[15px]"
              style={{
                background: "#fff",
                color: INK,
                border: `1px solid #D4DBE7`,
              }}
            >
              See the voice engine
            </a>
          </div>
          {!isSignedIn && (
            <p className="mt-4 text-[13px]" style={{ color: MUTED_2 }}>
              Monthly or annual · Cancel any time · 5 currencies
            </p>
          )}
        </div>

        <HeroProductPanel />
      </div>
    </section>
  );
}

/**
 * Product-mock panel shown alongside the hero copy. Static — no data
 * wiring — but every internal state (voice pill, waveform, format tabs,
 * copy body, action row) mirrors the actual /episodes/[id] drawer so a
 * visitor's first impression matches what they see once they sign in.
 */
function HeroProductPanel() {
  // Deterministic waveform heights so the mock renders identically on
  // every render (no random paint on hydration).
  const wave = [10, 18, 26, 14, 22, 9, 24, 16, 28, 12, 20, 8, 23, 15, 11];
  return (
    <div
      className="overflow-hidden rounded-[14px] bg-white"
      style={{
        border: `1px solid ${BORDER}`,
        boxShadow: "0 24px 60px -20px rgba(10,30,60,.18)",
      }}
    >
      <div
        className="flex items-center justify-between px-[18px] py-[14px]"
        style={{ borderBottom: `1px solid ${BORDER_SOFT}` }}
      >
        <span className="font-mono text-[11px]" style={{ color: MUTED_2, letterSpacing: "0.06em" }}>
          EP 41 · THE FOUNDER&apos;S CUT
        </span>
        <span
          className="rounded-full px-[10px] py-1 text-[11px] font-semibold"
          style={{
            background: "var(--color-accent-soft)",
            color: "var(--color-accent)",
          }}
        >
          Voice: Strong
        </span>
      </div>
      <div className="flex items-center gap-[10px] px-[18px] py-4">
        <div
          className="grid h-[34px] w-[34px] place-items-center rounded-full text-[12px] text-white"
          style={{ background: "var(--color-accent)" }}
        >
          ▶
        </div>
        <div className="flex h-[30px] flex-1 items-center gap-[2.5px]">
          {wave.map((h, i) => (
            <div
              key={i}
              className="w-[3px] rounded-[2px]"
              style={{
                height: h,
                background: i % 2 === 0 ? "var(--color-accent)" : "#C6D3EC",
              }}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-[6px] px-[18px] pb-3">
        <span
          className="rounded-[7px] px-[12px] py-[6px] text-[12px] font-semibold text-white"
          style={{ background: INK }}
        >
          LinkedIn
        </span>
        <span className="px-[12px] py-[6px] text-[12px] font-semibold" style={{ color: MUTED_2 }}>
          X thread
        </span>
        <span className="px-[12px] py-[6px] text-[12px] font-semibold" style={{ color: MUTED_2 }}>
          Show notes
        </span>
        <span className="px-[12px] py-[6px] text-[12px] font-semibold" style={{ color: MUTED_2 }}>
          +4
        </span>
      </div>
      <div
        className="mx-[18px] rounded-[10px] p-4 text-[13.5px] leading-[1.65]"
        style={{
          background: CANVAS,
          border: `1px solid ${BORDER_SOFT}`,
          color: "#2C3A52",
        }}
      >
        Most founders don&apos;t have a growth problem. They have a focus problem. This week: why
        saying no to a great opportunity is the highest-leverage thing you&apos;ll make all quarter
        — and why it never gets easier.
      </div>
      <div className="flex items-center justify-between px-[18px] pt-[14px] pb-[18px]">
        <span className="font-mono text-[11px]" style={{ color: MUTED_3 }}>
          generated in 48s
        </span>
        <div className="flex gap-2">
          <span
            className="rounded-[7px] px-[14px] py-[7px] text-[12px] font-semibold"
            style={{ border: `1px solid #D4DBE7`, color: MUTED }}
          >
            Tweak
          </span>
          <span
            className="rounded-[7px] px-[14px] py-[7px] text-[12px] font-semibold text-white"
            style={{ background: "var(--color-accent)" }}
          >
            Approve
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// TrustedBy — thin studio-logos strip between hero and problem
// ============================================================

function TrustedBy({ trustedBy }: { trustedBy: LandingTrustedBy & { heading: string } }) {
  if (trustedBy.studios.length === 0) return null;
  return (
    <div
      className="px-5 py-5 sm:px-8 sm:py-[22px] lg:px-14"
      style={{
        background: "#fff",
        borderTop: `1px solid ${BORDER_SOFT}`,
        borderBottom: `1px solid ${BORDER_SOFT}`,
      }}
    >
      <div
        className="mx-auto flex flex-wrap items-center gap-x-6 gap-y-3 sm:gap-x-11 sm:gap-y-4"
        style={{ maxWidth: 1180 }}
      >
        <span
          className="font-mono text-[11px] font-medium uppercase"
          style={{ letterSpacing: "0.12em", color: MUTED_2 }}
        >
          {trustedBy.heading}
        </span>
        {trustedBy.studios.map((s) => {
          const label = (
            <span
              className="text-[14px] font-bold sm:text-[15px]"
              style={{ color: MUTED_3, fontFamily: "var(--font-display)" }}
            >
              {s.name}
            </span>
          );
          return s.href ? (
            <Link
              key={s.name}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="no-underline"
            >
              {label}
            </Link>
          ) : (
            <span key={s.name}>{label}</span>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// Problem
// ============================================================

function Problem() {
  const stats = [
    {
      value: "6–9h",
      caption: "to manually repurpose one episode across platforms",
    },
    {
      value: "3+",
      caption: "edit rounds to get a freelancer draft to sound like the client",
    },
    {
      value: "$40–70",
      caption: "per episode in contractor time — before you've posted",
    },
  ];
  return (
    <section
      className="px-5 py-14 sm:px-8 sm:py-20 lg:px-14 lg:py-[88px]"
      style={{ background: "#fff" }}
    >
      <div className="mx-auto grid gap-10 md:grid-cols-2 lg:gap-16" style={{ maxWidth: 1180 }}>
        <div>
          <Kicker>The problem</Kicker>
          <H2>Content doesn&apos;t scale with your client count.</H2>
          <p
            className="m-0 mt-[18px] max-w-[420px] text-[15px] leading-[1.65] sm:text-[16px]"
            style={{ color: MUTED }}
          >
            Every new show means more posts, more platforms, more &ldquo;make it sound like
            them.&rdquo; So you hire VAs, juggle freelancers, and still rewrite everything yourself
            at 11pm. The work grows linearly. Your margins don&apos;t.
          </p>
        </div>
        <div
          className="grid grid-cols-1 gap-px overflow-hidden rounded-[12px] sm:grid-cols-3"
          style={{
            background: BORDER,
            border: `1px solid ${BORDER}`,
          }}
        >
          {stats.map((s) => (
            <div key={s.value} className="bg-white px-5 py-6 sm:px-[22px] sm:py-[26px]">
              <div
                className="text-[28px] font-extrabold sm:text-[34px]"
                style={{ letterSpacing: "-0.02em", color: INK }}
              >
                {s.value}
              </div>
              <div className="mt-2 text-[13px] leading-[1.5]" style={{ color: MUTED }}>
                {s.caption}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// How it works
// ============================================================

function HowItWorks() {
  const steps = [
    {
      num: "01",
      title: "Drop in a transcript",
      body: "Paste text, upload audio, or connect an RSS feed or YouTube link. We handle the rest.",
      tags: ["paste", "audio", "rss"],
      highlight: false,
    },
    {
      num: "02",
      title: "Get content in their voice",
      body: "A full set of platform-ready posts, written in that specific client's voice — not generic AI copy.",
      tags: ["7 formats", "< 60s"],
      highlight: false,
    },
    {
      num: "03",
      title: "Approve, and it sharpens",
      body: "Every post you approve teaches the voice engine. The next episode comes back closer to perfect.",
      tags: ["voice +8% this week"],
      highlight: true,
    },
  ];
  return (
    <section
      id="how"
      className="px-5 pb-14 sm:px-8 sm:pb-20 lg:px-14 lg:pb-[88px]"
      style={{ background: "#fff" }}
    >
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <Kicker>How it works</Kicker>
        <H2 maxWidth={560}>From transcript to a full content set in three steps.</H2>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 sm:gap-5 lg:mt-10 lg:grid-cols-3">
          {steps.map((s) => (
            <div
              key={s.num}
              className="rounded-[12px] p-5 sm:p-[26px]"
              style={{
                border: `1px solid ${BORDER}`,
                background: s.highlight ? CANVAS : "#fff",
              }}
            >
              <div className="font-mono text-[12px]" style={{ color: MUTED_2 }}>
                {s.num}
              </div>
              <div
                className="mt-3 mb-2 text-[18px] font-bold sm:text-[19px]"
                style={{ color: INK }}
              >
                {s.title}
              </div>
              <p className="m-0 text-[14px] leading-[1.6]" style={{ color: MUTED }}>
                {s.body}
              </p>
              <div className="mt-4 flex flex-wrap gap-[6px]">
                {s.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full px-[10px] py-[4px] font-mono text-[11px]"
                    style={
                      s.highlight
                        ? {
                            background: "var(--color-accent-soft)",
                            color: "var(--color-accent)",
                          }
                        : { background: "#F1F4F9", color: MUTED }
                    }
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// Video showcase — desktop-only demo strip
// ============================================================

/**
 * Short muted demo that sits between "How it works" and "Voice engine" —
 * the narrative reads "here are the three steps → here it is happening
 * → here's the engine behind it," which is why this lands *between*
 * those two sections rather than replacing the hero product mock.
 *
 * Desktop-only on purpose. `hidden md:block` on the wrapper means the
 * `<video>` element is `display: none` on phones, which:
 *   - skips autoplay entirely on every modern browser,
 *   - drops the 15 MB payload off the mobile network cost (with
 *     `preload="metadata"` a few KB of container header may still be
 *     fetched — acceptable, and the actual bytes only flow if the
 *     visitor resizes into desktop and the element becomes visible).
 *
 * Motion accessibility: `muted` + `loop` means the video is a decorative
 * moving image, no sound, no controls, no keyboard trap. Users with
 * `prefers-reduced-motion` still see a moving loop — we intentionally
 * skip pausing for that class because the whole section is optional
 * embellishment (they can scroll past instantly).
 */
function VideoShowcase() {
  return (
    <section
      className="hidden px-5 py-14 sm:px-8 sm:py-20 md:block lg:px-14 lg:py-[88px]"
      style={{ background: "#fff", borderTop: `1px solid ${BORDER_SOFT}` }}
    >
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4 sm:mb-10 sm:gap-6">
          <div>
            <Kicker>See it in action</Kicker>
            <H2 maxWidth={560}>A full episode, seven formats, one voice.</H2>
          </div>
          <div className="pb-1 text-[14px]" style={{ color: MUTED_2 }}>
            Voice-true content in under a minute
          </div>
        </div>
        <div
          className="overflow-hidden rounded-[14px]"
          style={{
            // Match the HeroProductPanel's frame so the two visual
            // "product windows" on the page read as a set.
            border: `1px solid ${BORDER}`,
            boxShadow: "0 24px 60px -20px rgba(10,30,60,.18)",
            background: CANVAS,
            // Explicit aspect ratio on the WRAPPER so the section
            // reserves space before the video's intrinsic dimensions
            // arrive with the metadata packet. Prevented a first-paint
            // where the section rendered at 0px height and looked
            // blank until the video decoded.
            aspectRatio: "16 / 9",
          }}
        >
          <video
            className="block h-full w-full"
            src="/videos/repodcast-voice-tip.mp4"
            autoPlay
            muted
            loop
            playsInline
            // `preload="auto"` on desktop-only content — the 15 MB is
            // acceptable when we've already gated phones out at the
            // section level. `metadata` was too conservative: some
            // browsers wouldn't decode the first frame until playback
            // started, and combined with strict autoplay policies that
            // left an empty rectangle.
            preload="auto"
            aria-label="Repodcast demo — turning an episode transcript into voice-true content"
          />
        </div>
      </div>
    </section>
  );
}

// ============================================================
// Voice engine — dark band
// ============================================================

function VoiceEngine() {
  const traits = [
    "Short, declarative opener",
    "Drops one contrarian take early",
    "Ends with a soft CTA, never salesy",
    'Never uses "game-changer"',
  ];
  return (
    <section
      id="voice"
      className="px-5 py-14 text-white sm:px-8 sm:py-20 lg:px-14 lg:py-[80px]"
      style={{ background: INK }}
    >
      <div
        className="mx-auto grid items-center gap-10 md:grid-cols-2 lg:gap-16"
        style={{ maxWidth: 1180 }}
      >
        <div>
          <div
            className="mb-4 font-mono text-[11px] font-semibold uppercase sm:text-[12px]"
            style={{ letterSpacing: "0.14em", color: "var(--color-accent-soft)" }}
          >
            The voice engine
          </div>
          <div
            className="text-[28px] leading-[1.14] font-extrabold sm:text-[32px] sm:leading-[1.13] lg:text-[38px] lg:leading-[1.12]"
            style={{ letterSpacing: "-0.02em" }}
          >
            It learns each client, one approval at a time.
          </div>
          <p
            className="m-0 mt-[18px] max-w-[440px] text-[15px] leading-[1.65] sm:text-[16px]"
            style={{ color: "#A9B8D4" }}
          >
            A separate voice model per client — trained on their words, their cadence, their pet
            phrases. The more you use it, the stronger the match.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-5 sm:mt-8 sm:gap-7">
            <div>
              <div className="text-[24px] font-extrabold sm:text-[26px]">38</div>
              <div className="mt-1 text-[12.5px]" style={{ color: "#A9B8D4" }}>
                approved posts in this voice
              </div>
            </div>
            <div
              className="hidden h-[36px] w-px sm:block"
              style={{ background: "rgba(255,255,255,0.12)" }}
            />
            <div>
              <div
                className="text-[24px] font-extrabold sm:text-[26px]"
                style={{ color: "var(--color-accent-soft)" }}
              >
                Strong
              </div>
              <div className="mt-1 text-[12.5px]" style={{ color: "#A9B8D4" }}>
                voice strength, month over month
              </div>
            </div>
          </div>
        </div>

        <div
          className="rounded-[14px] p-5 sm:p-[22px]"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.10)",
          }}
        >
          <div
            className="mb-[14px] font-mono text-[11px]"
            style={{ letterSpacing: "0.12em", color: "var(--color-accent-soft)" }}
          >
            LEARNED TRAITS · THE FOUNDER&apos;S CUT
          </div>
          <div className="flex flex-col gap-[10px]">
            {traits.map((t) => (
              <div
                key={t}
                className="flex items-center gap-[10px] text-[14px]"
                style={{ color: "#DBE4F5" }}
              >
                <span
                  className="h-[6px] w-[6px] flex-shrink-0 rounded-full"
                  style={{ background: "var(--color-accent)" }}
                />
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================
// Outputs — every format
// ============================================================

function Outputs() {
  const tiles = [
    { badge: "X", title: "X thread", sub: "8–12 posts", bg: INK, fg: "#fff" },
    {
      badge: "in",
      title: "LinkedIn post",
      sub: "long-form",
      bg: "var(--color-accent)",
      fg: "#fff",
    },
    { badge: "Ig", title: "Instagram caption", sub: "+ hashtags", bg: MUTED, fg: "#fff" },
    { badge: "Tk", title: "TikTok script", sub: "60–90s", bg: INK, fg: "#fff" },
    { badge: "≡", title: "Show notes", sub: "episode page", bg: MUTED, fg: "#fff" },
    { badge: "B", title: "Blog post", sub: "SEO-ready", bg: "var(--color-accent)", fg: "#fff" },
    { badge: "✉", title: "Newsletter", sub: "email-ready", bg: INK, fg: "#fff" },
  ];
  return (
    <section
      className="px-5 py-14 sm:px-8 sm:py-20 lg:px-14 lg:py-[88px]"
      style={{ background: "#fff" }}
    >
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <div className="flex flex-wrap items-end justify-between gap-4 sm:gap-6">
          <div>
            <Kicker>Every output, every episode</Kicker>
            <H2>One transcript. Seven formats.</H2>
          </div>
          <div className="pb-1 text-[13px] sm:text-[14px]" style={{ color: MUTED_2 }}>
            7× the output, one draft pass
          </div>
        </div>
        <div className="mt-7 grid grid-cols-1 gap-3 sm:mt-9 sm:grid-cols-2 sm:gap-[14px] lg:grid-cols-4">
          {tiles.map((t) => (
            <div
              key={t.title}
              className="flex items-center gap-3 rounded-[10px] p-4 sm:p-[18px]"
              style={{ border: `1px solid ${BORDER}` }}
            >
              <div
                className="grid h-[34px] w-[34px] flex-shrink-0 place-items-center rounded-[8px] text-[13px] font-extrabold"
                style={{ background: t.bg, color: t.fg }}
              >
                {t.badge}
              </div>
              <div>
                <div className="text-[14.5px] font-bold" style={{ color: INK }}>
                  {t.title}
                </div>
                <div className="text-[12px]" style={{ color: MUTED_2 }}>
                  {t.sub}
                </div>
              </div>
            </div>
          ))}
          <div
            className="flex items-center rounded-[10px] p-4 text-[14.5px] font-bold sm:col-span-2 sm:p-[18px] lg:col-span-1"
            style={{
              background: "var(--color-accent-soft)",
              color: "var(--color-accent)",
            }}
          >
            All written in the client&apos;s voice.
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================
// Pricing — thin wrapper around <PricingPicker>
// ============================================================

function Pricing({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <section
      id="pricing"
      className="px-5 py-14 sm:px-8 sm:py-20 lg:px-14 lg:py-[88px]"
      style={{ background: CANVAS, borderTop: `1px solid ${BORDER_SOFT}` }}
    >
      <div className="mx-auto text-center" style={{ maxWidth: 1180 }}>
        <Kicker centered>Pricing</Kicker>
        <div className="mx-auto" style={{ maxWidth: 640 }}>
          <H2 centered>Priced per studio, not per post.</H2>
        </div>
        <p className="mt-3 text-[14px] sm:text-[15px]" style={{ color: MUTED }}>
          One episode of saved contractor time usually covers the month.
        </p>
        <div className="mt-9 text-left sm:mt-11">
          {/* Signed-in visitors have already consumed their trial gate, so
              we suppress the trial framing to match the /pricing surface. */}
          <PricingPicker kind="public" trialEligible={!isSignedIn} />
        </div>
      </div>
    </section>
  );
}

// ============================================================
// FAQ — thin wrapper preserved from the previous revision
// ============================================================

function FAQ() {
  return (
    <section
      id="faq"
      className="px-5 py-14 sm:px-8 sm:py-16 lg:px-14 lg:py-[80px]"
      style={{ background: "#fff", borderTop: `1px solid ${BORDER_SOFT}` }}
    >
      <div className="mx-auto" style={{ maxWidth: 820 }}>
        <div className="mb-7 text-center sm:mb-9">
          <Kicker centered>Questions</Kicker>
          <H2 centered>Everything you need to know.</H2>
        </div>
        <FAQAccordion />
      </div>
    </section>
  );
}

// ============================================================
// Final CTA bar
// ============================================================

/**
 * Deterministic equalizer heights driving the animated background wave.
 * Fixed on the module (not per-render) so SSR and hydration agree.
 * Each bar's `animation-delay` is derived from the index — see the CSS
 * body — so the wave phases across the strip instead of pulsing in
 * lockstep. Keyframe: `@keyframes eq` in `app/globals.css`.
 */
const WAVE_SEED = [
  8, 16, 11, 22, 14, 28, 12, 19, 26, 10, 18, 30, 13, 24, 9, 20, 15, 27, 11, 21, 17, 29, 12, 23, 8,
  18, 25, 14, 31, 10, 19, 13, 26, 16, 9, 22, 12, 28, 15, 20, 11, 24, 8, 17, 30, 13, 21, 9, 18, 27,
];

function FinalCTA({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <section
      className="relative overflow-hidden px-5 py-8 text-white sm:px-8 sm:py-9 lg:px-14"
      style={{ background: INK }}
    >
      {/* Animated equalizer wave sitting behind the CTA copy — brings
          the old FinalCTA's motion back after the 1a revamp compressed
          the whole strip. `pointer-events-none` + low opacity so the
          bars never fight the copy for attention. */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center gap-[3px] px-5 sm:gap-[5px] sm:px-8 lg:px-14"
        style={{ opacity: 0.1 }}
        aria-hidden
      >
        {WAVE_SEED.map((h, i) => (
          <span
            key={i}
            style={{
              flex: 1,
              height: 30 + h * 2.4,
              borderRadius: 2,
              background: "var(--color-accent)",
              transformOrigin: "center",
              animation: "eq 1.4s ease-in-out infinite",
              animationDelay: `${((i % 11) * 0.09).toFixed(2)}s`,
            }}
          />
        ))}
      </div>

      <div className="relative flex flex-wrap items-center justify-between gap-5 sm:gap-6">
        <div
          className="text-[18px] font-extrabold sm:text-[22px]"
          style={{ letterSpacing: "-0.02em" }}
        >
          Give your contractor hours back.
        </div>
        <Link
          href={isSignedIn ? "/after-sign-in" : "/pricing"}
          className="rounded-[9px] px-5 py-3 text-[14px] font-semibold text-white no-underline transition-[filter] hover:brightness-110 sm:px-[22px] sm:py-3 sm:text-[15px]"
          style={{ background: "var(--color-accent)" }}
        >
          {isSignedIn ? "Continue" : "Get started"}
        </Link>
      </div>
    </section>
  );
}

// ============================================================
// Shared display helpers
// ============================================================

function Kicker({ children, centered = false }: { children: React.ReactNode; centered?: boolean }) {
  return (
    <div
      className={`mb-4 font-mono text-[12px] font-semibold uppercase ${centered ? "text-center" : ""}`}
      style={{ letterSpacing: "0.14em", color: "var(--color-accent)" }}
    >
      {children}
    </div>
  );
}

function H2({
  children,
  maxWidth,
  centered = false,
}: {
  children: React.ReactNode;
  maxWidth?: number;
  centered?: boolean;
}) {
  return (
    <div
      className={`text-[26px] leading-[1.16] sm:text-[32px] sm:leading-[1.14] lg:text-[38px] lg:leading-[1.12] ${centered ? "text-center" : ""}`}
      style={{
        fontFamily: "var(--font-display)",
        fontWeight: 800,
        letterSpacing: "-0.02em",
        color: INK,
        maxWidth,
        marginInline: centered ? "auto" : undefined,
      }}
    >
      {children}
    </div>
  );
}
