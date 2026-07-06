import Link from "next/link";
import { PricingPicker } from "@/components/pricing/pricing-picker";
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
 * card), Outputs (seven format tiles + accent chip), SocialProof
 * (testimonials — kept from the previous revision, adds trust beyond
 * the ref's scope), Pricing, FAQ, FinalCTA.
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
}: {
  isSignedIn?: boolean;
  /**
   * Managed from `/root/config` under the `LANDING_TRUSTED_BY` key.
   * Server fetch + fallback lives in `lib/landing-trusted-by.ts`; the
   * landing page itself just renders what it's given.
   */
  trustedBy?: LandingTrustedBy & { heading: string };
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
      <VoiceEngine />
      <Outputs />
      <SocialProof />
      <Pricing isSignedIn={isSignedIn} />
      <FAQ />
      <FinalCTA isSignedIn={isSignedIn} />
      <LandingFooter />
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
      className="px-14 pt-[76px] pb-16"
      style={{ background: `linear-gradient(180deg,#fff 0%,${CANVAS} 100%)` }}
    >
      <div
        className="mx-auto grid items-center gap-14"
        style={{ maxWidth: 1180, gridTemplateColumns: "1.05fr 0.95fr" }}
      >
        <div>
          <div
            className="mb-5 font-mono text-[12px] font-semibold uppercase"
            style={{ letterSpacing: "0.14em", color: "var(--color-accent)" }}
          >
            For podcast agencies
          </div>
          <h1
            className="m-0"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 58,
              lineHeight: 1.04,
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
            className="m-0 mt-6 mb-8"
            style={{
              fontSize: 18,
              lineHeight: 1.6,
              color: MUTED,
              maxWidth: 480,
            }}
          >
            Turn every client episode into platform-ready content — X threads, LinkedIn posts, show
            notes, and more — written in your client&apos;s exact voice, in under 60 seconds.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={isSignedIn ? "/after-sign-in" : "/pricing"}
              className="rounded-[9px] text-[15px] font-semibold text-white no-underline transition-[filter] hover:brightness-110"
              style={{ background: INK, padding: "13px 24px" }}
            >
              {isSignedIn ? "Continue" : "Get started"}
            </Link>
            <a
              href="#voice"
              className="rounded-[9px] text-[15px] font-semibold no-underline"
              style={{
                background: "#fff",
                color: INK,
                border: `1px solid #D4DBE7`,
                padding: "12px 22px",
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
      <div className="flex gap-[6px] px-[18px] pb-3">
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
      className="px-14 py-[22px]"
      style={{
        background: "#fff",
        borderTop: `1px solid ${BORDER_SOFT}`,
        borderBottom: `1px solid ${BORDER_SOFT}`,
      }}
    >
      <div className="mx-auto flex flex-wrap items-center gap-11" style={{ maxWidth: 1180 }}>
        <span
          className="font-mono text-[11px] font-medium uppercase"
          style={{ letterSpacing: "0.12em", color: MUTED_2 }}
        >
          {trustedBy.heading}
        </span>
        {trustedBy.studios.map((s) => {
          const label = (
            <span
              className="text-[15px] font-bold"
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
    <section className="px-14 py-[88px]" style={{ background: "#fff" }}>
      <div
        className="mx-auto grid gap-16"
        style={{ maxWidth: 1180, gridTemplateColumns: "1fr 1fr" }}
      >
        <div>
          <Kicker>The problem</Kicker>
          <H2>Content doesn&apos;t scale with your client count.</H2>
          <p
            className="m-0 mt-[18px] text-[16px] leading-[1.65]"
            style={{ color: MUTED, maxWidth: 420 }}
          >
            Every new show means more posts, more platforms, more &ldquo;make it sound like
            them.&rdquo; So you hire VAs, juggle freelancers, and still rewrite everything yourself
            at 11pm. The work grows linearly. Your margins don&apos;t.
          </p>
        </div>
        <div
          className="grid overflow-hidden rounded-[12px]"
          style={{
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 1,
            background: BORDER,
            border: `1px solid ${BORDER}`,
          }}
        >
          {stats.map((s) => (
            <div key={s.value} className="bg-white px-[22px] py-[26px]">
              <div
                className="text-[34px] font-extrabold"
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
    <section id="how" className="px-14 pb-[88px]" style={{ background: "#fff" }}>
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <Kicker>How it works</Kicker>
        <H2 maxWidth={560}>From transcript to a full content set in three steps.</H2>

        <div className="mt-10 grid" style={{ gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
          {steps.map((s) => (
            <div
              key={s.num}
              className="rounded-[12px] p-[26px]"
              style={{
                border: `1px solid ${BORDER}`,
                background: s.highlight ? CANVAS : "#fff",
              }}
            >
              <div className="font-mono text-[12px]" style={{ color: MUTED_2 }}>
                {s.num}
              </div>
              <div className="mt-3 mb-2 text-[19px] font-bold" style={{ color: INK }}>
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
    <section id="voice" className="px-14 py-[80px] text-white" style={{ background: INK }}>
      <div
        className="mx-auto grid items-center gap-16"
        style={{ maxWidth: 1180, gridTemplateColumns: "1fr 1fr" }}
      >
        <div>
          <div
            className="mb-4 font-mono text-[12px] font-semibold uppercase"
            style={{ letterSpacing: "0.14em", color: "var(--color-accent-soft)" }}
          >
            The voice engine
          </div>
          <div
            className="text-[38px] font-extrabold"
            style={{ letterSpacing: "-0.02em", lineHeight: 1.12 }}
          >
            It learns each client, one approval at a time.
          </div>
          <p
            className="m-0 mt-[18px] text-[16px] leading-[1.65]"
            style={{ color: "#A9B8D4", maxWidth: 440 }}
          >
            A separate voice model per client — trained on their words, their cadence, their pet
            phrases. The more you use it, the stronger the match.
          </p>
          <div className="mt-8 flex items-center gap-7">
            <div>
              <div className="text-[26px] font-extrabold">38</div>
              <div className="mt-1 text-[12.5px]" style={{ color: "#A9B8D4" }}>
                approved posts in this voice
              </div>
            </div>
            <div className="h-[36px] w-px" style={{ background: "rgba(255,255,255,0.12)" }} />
            <div>
              <div
                className="text-[26px] font-extrabold"
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
          className="rounded-[14px] p-[22px]"
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
                  className="h-[6px] w-[6px] rounded-full"
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
    <section className="px-14 py-[88px]" style={{ background: "#fff" }}>
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <div className="flex items-end justify-between gap-6">
          <div>
            <Kicker>Every output, every episode</Kicker>
            <H2>One transcript. Seven formats.</H2>
          </div>
          <div className="pb-1 text-[14px]" style={{ color: MUTED_2 }}>
            7× the output, one draft pass
          </div>
        </div>
        <div className="mt-9 grid" style={{ gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
          {tiles.map((t) => (
            <div
              key={t.title}
              className="flex items-center gap-3 rounded-[10px] p-[18px]"
              style={{ border: `1px solid ${BORDER}` }}
            >
              <div
                className="grid h-[34px] w-[34px] place-items-center rounded-[8px] text-[13px] font-extrabold"
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
            className="flex items-center rounded-[10px] p-[18px] text-[14.5px] font-bold"
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
// Social proof — kept from the previous revision because
// the ref doesn't include testimonials and dropping them loses
// signal for cold visitors.
// ============================================================

function SocialProof() {
  const testimonials = [
    {
      quote:
        "We dropped two freelancers and our turnaround went from four days to same-day. And it actually sounds like our hosts — clients stopped asking for rewrites.",
      initials: "MO",
      name: "Maya Okafor",
      role: "Founder, Northwind Audio",
    },
    {
      quote:
        "Six shows, one afternoon. What used to eat my whole week is now a review queue. The white-label means clients think we built it in-house.",
      initials: "DC",
      name: "Devin Castellanos",
      role: "Owner, Tightrope Studio",
    },
    {
      quote:
        "By the third episode for each client the edits basically vanish. It's the first tool that got better instead of staying mediocre.",
      initials: "PR",
      name: "Priya Raman",
      role: "Director, Frequency Lab",
    },
  ];
  return (
    <section
      className="px-14 py-[72px]"
      style={{ background: "#fff", borderTop: `1px solid ${BORDER_SOFT}` }}
    >
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <div className="mb-9" style={{ maxWidth: 620 }}>
          <Kicker>From the studios using it</Kicker>
          <H2>Built to give contractor hours back.</H2>
        </div>
        <div
          className="grid overflow-hidden rounded-[14px]"
          style={{
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 1,
            background: BORDER,
            border: `1px solid ${BORDER}`,
          }}
        >
          {testimonials.map((t) => (
            <div key={t.name} className="flex flex-col bg-white" style={{ padding: "34px 30px" }}>
              <p
                className="m-0 mb-[26px] flex-1 text-[16px] leading-[1.6]"
                style={{ color: INK, letterSpacing: "-0.01em" }}
              >
                &ldquo;{t.quote}&rdquo;
              </p>
              <div className="flex items-center gap-3">
                <span
                  className="flex h-[42px] w-[42px] items-center justify-center rounded-full text-[14px] font-semibold text-white"
                  style={{ background: INK, fontFamily: "var(--font-display)" }}
                >
                  {t.initials}
                </span>
                <div>
                  <div className="text-[14.5px] font-semibold" style={{ color: INK }}>
                    {t.name}
                  </div>
                  <div className="mt-[2px] font-mono text-[11.5px]" style={{ color: MUTED_2 }}>
                    {t.role}
                  </div>
                </div>
              </div>
            </div>
          ))}
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
      className="px-14 py-[88px]"
      style={{ background: CANVAS, borderTop: `1px solid ${BORDER_SOFT}` }}
    >
      <div className="mx-auto text-center" style={{ maxWidth: 1180 }}>
        <Kicker centered>Pricing</Kicker>
        <div className="mx-auto" style={{ maxWidth: 640 }}>
          <H2 centered>Priced per studio, not per post.</H2>
        </div>
        <p className="mt-3 text-[15px]" style={{ color: MUTED }}>
          One episode of saved contractor time usually covers the month.
        </p>
        <div className="mt-11 text-left">
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
      className="px-14 py-[80px]"
      style={{ background: "#fff", borderTop: `1px solid ${BORDER_SOFT}` }}
    >
      <div className="mx-auto" style={{ maxWidth: 820 }}>
        <div className="mb-9" style={{ textAlign: "center" }}>
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
    <section className="relative overflow-hidden px-14 py-9 text-white" style={{ background: INK }}>
      {/* Animated equalizer wave sitting behind the CTA copy — brings
          the old FinalCTA's motion back after the 1a revamp compressed
          the whole strip. `pointer-events-none` + low opacity so the
          bars never fight the copy for attention. */}
      <div
        className="pointer-events-none absolute inset-0 flex items-center gap-[5px] px-14"
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

      <div className="relative flex flex-wrap items-center justify-between gap-6">
        <div className="text-[22px] font-extrabold" style={{ letterSpacing: "-0.02em" }}>
          Give your contractor hours back.
        </div>
        <Link
          href={isSignedIn ? "/after-sign-in" : "/pricing"}
          className="rounded-[9px] text-[15px] font-semibold text-white no-underline transition-[filter] hover:brightness-110"
          style={{ background: "var(--color-accent)", padding: "12px 22px" }}
        >
          {isSignedIn ? "Continue" : "Get started free"}
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
      className={centered ? "text-center" : ""}
      style={{
        fontFamily: "var(--font-display)",
        fontSize: 38,
        lineHeight: 1.12,
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
