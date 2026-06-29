import Link from "next/link";
import { ClientPicker } from "./client-picker";
import { FAQAccordion } from "./faq-accordion";

/**
 * Marketing landing (Phase 3.1). Layout mirrors
 * `ref/UI/Landing/Repodcast Landing.dc.html`.
 *
 * Everything below renders server-side except the two interactive client
 * components (`<ClientPicker>`, `<FAQAccordion>`) — initial frames are
 * server-rendered too, so the page is hydration-shift-free.
 *
 * Styling note: marketing-surface tokens (mint, deep-ink, etc.) are
 * inlined as hex values rather than Tailwind classes — the landing has
 * its own palette and the inline-style pattern matches the dashboard's
 * defensive approach so a stale Tailwind cache can't break the visual.
 */
export function LandingPage({ isSignedIn = false }: { isSignedIn?: boolean }) {
  return (
    <div className="w-full overflow-x-hidden">
      <Nav isSignedIn={isSignedIn} />
      <Hero isSignedIn={isSignedIn} />
      <Problem />
      <HowItWorks />
      <VoiceEngine />
      <Pillars />
      <Outputs />
      <SocialProof />
      <Pricing isSignedIn={isSignedIn} />
      <FAQ />
      <FinalCTA isSignedIn={isSignedIn} />
      <Footer />
    </div>
  );
}

/* ============================================================
   Nav
   ============================================================ */

function BrandMark({ darkBg = false }: { darkBg?: boolean }) {
  return (
    <div className="flex items-center gap-[9px]">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="0.5" y="0.5" width="21" height="21" rx="6" fill={darkBg ? "#3A5BA0" : "#1A2A4A"} />
        <rect x="7" y="9" width="2" height="4" rx="1" fill="#fff" />
        <rect x="10" y="6" width="2" height="10" rx="1" fill="#fff" />
        <rect x="13" y="8" width="2" height="6" rx="1" fill="#fff" />
      </svg>
      <span
        className="text-[17.5px] font-bold"
        style={{
          fontFamily: "var(--font-display)",
          color: darkBg ? "#FFFFFF" : "#1A2A4A",
          letterSpacing: "-0.03em",
        }}
      >
        Repodcast
      </span>
    </div>
  );
}

function Nav({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <header
      className="sticky top-0 z-50"
      style={{
        background: "rgba(255,255,255,0.85)",
        backdropFilter: "saturate(180%) blur(16px)",
        WebkitBackdropFilter: "saturate(180%) blur(16px)",
        borderBottom: "1px solid #ECEEF3",
      }}
    >
      <nav
        className="mx-auto flex items-center justify-between gap-6 px-7 py-[15px]"
        style={{ maxWidth: 1180 }}
      >
        <div className="flex items-center gap-[38px]">
          <BrandMark />
          <div
            className="hidden items-center gap-[26px] text-[14px] font-normal md:flex"
            style={{ color: "#5A6473" }}
          >
            <a
              href="#how"
              className="no-underline transition-colors hover:text-[#1A2A4A]"
              style={{ color: "inherit" }}
            >
              How it works
            </a>
            <a
              href="#voice"
              className="no-underline transition-colors hover:text-[#1A2A4A]"
              style={{ color: "inherit" }}
            >
              Voice Engine
            </a>
            <a
              href="#pricing"
              className="no-underline transition-colors hover:text-[#1A2A4A]"
              style={{ color: "inherit" }}
            >
              Pricing
            </a>
            <a
              href="#faq"
              className="no-underline transition-colors hover:text-[#1A2A4A]"
              style={{ color: "inherit" }}
            >
              FAQ
            </a>
          </div>
        </div>
        <div className="flex items-center gap-[18px]">
          {isSignedIn ? (
            <Link
              href="/dashboard"
              className="rounded-lg text-[14px] font-medium no-underline transition-colors"
              style={{
                background: "#1A2A4A",
                color: "#FFFFFF",
                padding: "9px 17px",
              }}
            >
              Open dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="text-[14px] font-medium no-underline"
                style={{ color: "#1A2A4A" }}
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="rounded-lg text-[14px] font-medium no-underline transition-colors"
                style={{
                  background: "#1A2A4A",
                  color: "#FFFFFF",
                  padding: "9px 17px",
                }}
              >
                Start free
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

/* ============================================================
   Hero
   ============================================================ */

function Hero({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <section
      className="relative overflow-hidden"
      style={{
        background: "linear-gradient(180deg,#fff 0%,#FBFCFE 100%)",
        borderBottom: "1px solid #ECEEF3",
      }}
    >
      <div
        className="pointer-events-none absolute"
        style={{
          top: "-160px",
          right: "-120px",
          width: 520,
          height: 520,
          borderRadius: "50%",
          background: "radial-gradient(circle,rgba(58,91,160,0.10) 0%,rgba(58,91,160,0) 70%)",
          animation: "floaty 9s ease-in-out infinite",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(#1A2A4A 0.8px, transparent 0.8px)",
          backgroundSize: "24px 24px",
          opacity: 0.035,
        }}
      />
      <div
        className="relative mx-auto grid items-center gap-14 px-7 lg:gap-14"
        style={{
          maxWidth: 1180,
          paddingTop: 60,
          paddingBottom: 52,
          gridTemplateColumns: "1.02fr 0.98fr",
        }}
      >
        <div>
          <div
            className="mb-[26px] text-[12px] font-medium uppercase"
            style={{
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.14em",
              color: "#3A5BA0",
            }}
          >
            For podcast agencies
          </div>
          <h1
            className="m-0"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 56,
              lineHeight: 1.05,
              letterSpacing: "-0.035em",
              color: "#1A2A4A",
              marginBottom: 24,
            }}
          >
            Sounds exactly like you.
            <br />
            Gets better every episode.
          </h1>
          <p
            className="m-0"
            style={{
              fontSize: "18.5px",
              lineHeight: 1.6,
              color: "#5A6473",
              maxWidth: 478,
              marginBottom: 36,
              letterSpacing: "-0.01em",
            }}
          >
            Turn every client episode into platform-ready content — X threads, LinkedIn posts, show
            notes, and more — written in your client&apos;s exact voice, in under 60 seconds.
          </p>
          <div className="mb-[22px] flex items-center gap-3">
            <Link
              href={isSignedIn ? "/dashboard" : "/sign-up"}
              className="rounded-[9px] text-[15px] font-medium no-underline transition-colors"
              style={{
                background: "#1A2A4A",
                color: "#FFFFFF",
                padding: "13px 24px",
              }}
            >
              {isSignedIn ? "Open dashboard" : "Start free"}
            </Link>
            <Link
              href="#voice"
              className="rounded-[9px] text-[15px] font-medium no-underline transition-colors"
              style={{
                background: "#FFFFFF",
                color: "#1A2A4A",
                padding: "13px 24px",
                border: "1px solid #DDE2EC",
              }}
            >
              See the voice engine
            </Link>
          </div>
          {!isSignedIn && (
            <p className="m-0 text-[13px]" style={{ color: "#9AA3B2", letterSpacing: 0 }}>
              No credit card · 14-day trial · Cancel anytime
            </p>
          )}
        </div>

        <HeroProductPanel />
      </div>

      {/* Logo strip */}
      <div style={{ borderTop: "1px solid #ECEEF3" }}>
        <div
          className="mx-auto flex flex-wrap items-center gap-10 px-7 py-[22px]"
          style={{ maxWidth: 1180 }}
        >
          <span
            className="text-[11px] font-medium uppercase"
            style={{
              fontFamily: "var(--font-mono)",
              color: "#A6AEBC",
              letterSpacing: "0.1em",
            }}
          >
            Trusted by growing studios
          </span>
          <div className="flex flex-wrap items-center gap-[34px]" style={{ opacity: 0.65 }}>
            {["Northwind Audio", "Tightrope", "Frequency Lab", "Open Mic Co.", "Halftone"].map(
              (n) => (
                <span
                  key={n}
                  className="text-[15px] font-semibold"
                  style={{
                    fontFamily: "var(--font-display)",
                    color: "#7E8799",
                  }}
                >
                  {n}
                </span>
              ),
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroProductPanel() {
  const heroSeed = [
    5, 9, 14, 7, 20, 11, 26, 16, 30, 12, 22, 8, 18, 28, 13, 24, 10, 32, 15, 7, 19, 29, 12, 23, 9,
    17, 27, 14, 21, 6, 16, 25, 11, 30, 13, 8, 20, 15, 10, 18,
  ];
  return (
    <div
      className="overflow-hidden"
      style={{
        border: "1px solid #E4E8F0",
        borderRadius: 14,
        background: "#FFFFFF",
        boxShadow: "0 24px 60px -28px rgba(26,42,74,0.28)",
      }}
    >
      {/* Header row */}
      <div
        className="flex items-center justify-between"
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid #EEF0F5",
          background: "#FBFCFE",
        }}
      >
        <span
          className="text-[11px]"
          style={{
            fontFamily: "var(--font-mono)",
            color: "#9AA3B2",
            letterSpacing: "0.04em",
          }}
        >
          EP 47 · The Founder&apos;s Cut
        </span>
        <div
          className="inline-flex items-center gap-[7px] rounded-md"
          style={{ background: "#EAF7F0", padding: "5px 10px" }}
        >
          <span className="flex items-end gap-[1.5px]">
            <span style={{ width: 2.5, height: 6, background: "#1F8A5B", borderRadius: 1 }} />
            <span style={{ width: 2.5, height: 9, background: "#1F8A5B", borderRadius: 1 }} />
            <span style={{ width: 2.5, height: 12, background: "#1F8A5B", borderRadius: 1 }} />
          </span>
          <span className="text-[11.5px] font-semibold" style={{ color: "#1F8A5B" }}>
            Voice: Strong
          </span>
        </div>
      </div>

      {/* Dark audio band */}
      <div
        className="flex items-center gap-[14px]"
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid #EEF0F5",
          background: "#0F1B33",
        }}
      >
        <span
          className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full"
          style={{ background: "#3A5BA0" }}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="#fff">
            <path d="M2 1.2 9.3 5.5 2 9.8z" />
          </svg>
        </span>
        <div className="flex flex-1 items-center gap-[2px]" style={{ height: 34 }}>
          {heroSeed.map((h, i) => (
            <span
              key={i}
              style={{
                width: 3,
                height: h,
                borderRadius: 2,
                background: "#5B7FD0",
                transformOrigin: "center",
                animation: "eq 1.4s ease-in-out infinite",
                animationDelay: `${((i % 9) * 0.1).toFixed(2)}s`,
              }}
            />
          ))}
        </div>
        <span
          className="flex-shrink-0 text-[11px]"
          style={{ fontFamily: "var(--font-mono)", color: "#7E8BA8" }}
        >
          52:14
        </span>
      </div>

      {/* Tabs */}
      <div className="flex" style={{ borderBottom: "1px solid #EEF0F5", padding: "0 8px" }}>
        <span
          className="text-[12.5px] font-semibold"
          style={{
            color: "#1A2A4A",
            padding: "11px 12px",
            borderBottom: "2px solid #1A2A4A",
          }}
        >
          LinkedIn
        </span>
        {["X thread", "Show notes", "+4"].map((t) => (
          <span
            key={t}
            className="text-[12.5px] font-medium"
            style={{ color: "#9AA3B2", padding: "11px 12px" }}
          >
            {t}
          </span>
        ))}
      </div>

      {/* Body */}
      <div style={{ padding: "20px 20px 18px" }}>
        <p
          className="m-0"
          style={{
            fontSize: "14.5px",
            lineHeight: 1.62,
            color: "#2A3445",
            marginBottom: 16,
          }}
        >
          Most founders don&apos;t have a growth problem. They have a focus problem. This week: why
          saying no to a great opportunity is the highest-leverage move you&apos;ll make all quarter
          — and why it never gets easier. 👇
        </p>
        <div
          className="flex items-center justify-between"
          style={{ borderTop: "1px solid #F0F2F6", paddingTop: 14 }}
        >
          <span
            className="text-[11px]"
            style={{ fontFamily: "var(--font-mono)", color: "#9AA3B2" }}
          >
            generated in 48s
          </span>
          <div className="flex gap-2">
            <span
              className="rounded-md text-[12px] font-semibold"
              style={{ background: "#EAF7F0", color: "#1F8A5B", padding: "6px 12px" }}
            >
              Approve
            </span>
            <span
              className="rounded-md text-[12px] font-medium"
              style={{ background: "#F4F6FA", color: "#5A6473", padding: "6px 12px" }}
            >
              Tweak
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Section helpers
   ============================================================ */

function Kicker({ children, color = "#9AA3B2" }: { children: React.ReactNode; color?: string }) {
  return (
    <div
      className="mb-5 text-[12px] font-medium uppercase"
      style={{
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.14em",
        color,
      }}
    >
      {children}
    </div>
  );
}

function H2({
  children,
  color = "#1A2A4A",
  size = 38,
}: {
  children: React.ReactNode;
  color?: string;
  size?: number;
}) {
  return (
    <h2
      className="m-0"
      style={{
        fontFamily: "var(--font-display)",
        fontWeight: 700,
        fontSize: size,
        lineHeight: 1.12,
        letterSpacing: "-0.03em",
        color,
      }}
    >
      {children}
    </h2>
  );
}

/* ============================================================
   Problem
   ============================================================ */

function Problem() {
  return (
    <section
      className="px-7 py-[72px]"
      style={{ background: "#FFFFFF", borderBottom: "1px solid #ECEEF3" }}
    >
      <div
        className="mx-auto grid items-start gap-16"
        style={{ maxWidth: 1180, gridTemplateColumns: "0.85fr 1.15fr" }}
      >
        <div>
          <Kicker>The problem</Kicker>
          <H2>Content doesn&apos;t scale with your client count.</H2>
          <p className="m-0 mt-5" style={{ fontSize: 17, lineHeight: 1.64, color: "#5A6473" }}>
            Every new show means more posts, more platforms, more &quot;make it sound like
            them.&quot; So you hire VAs, juggle freelancers, and still rewrite everything yourself
            at 11pm. The work grows linearly. Your margins don&apos;t.
          </p>
        </div>
        <div
          className="grid overflow-hidden"
          style={{
            gridTemplateColumns: "1fr 1fr 1fr",
            border: "1px solid #E8EBF1",
            borderRadius: 14,
          }}
        >
          {[
            { value: "6–9h", body: "to manually repurpose one episode across platforms." },
            {
              value: "3+",
              body: "edit rounds to get a freelancer draft to sound like the client.",
            },
            { value: "$40–70", body: "per episode in contractor time — before you've posted." },
          ].map((s, i) => (
            <div
              key={s.value}
              style={{
                padding: "32px 26px",
                borderRight: i < 2 ? "1px solid #EEF0F5" : "none",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 700,
                  fontSize: 32,
                  color: "#1A2A4A",
                  letterSpacing: "-0.02em",
                }}
              >
                {s.value}
              </div>
              <p
                className="m-0 mt-[10px]"
                style={{ fontSize: 14, color: "#5A6473", lineHeight: 1.5 }}
              >
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   How it works
   ============================================================ */

function HowItWorks() {
  return (
    <section
      id="how"
      className="px-7 py-[72px]"
      style={{ background: "#FBFCFE", borderBottom: "1px solid #ECEEF3" }}
    >
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <div className="mb-10" style={{ maxWidth: 620 }}>
          <Kicker>How it works</Kicker>
          <H2>From transcript to a full content set in three steps.</H2>
        </div>
        <div
          className="grid overflow-hidden"
          style={{
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 1,
            background: "#E8EBF1",
            border: "1px solid #E8EBF1",
            borderRadius: 14,
          }}
        >
          {[
            {
              n: "01",
              title: "Drop in a transcript",
              body: "Paste text, upload audio, or connect an RSS feed or YouTube link. We handle the rest.",
              tags: ["paste", "audio", "rss", "youtube"],
              tagAccent: false,
            },
            {
              n: "02",
              title: "Get content in their voice",
              body: "A full set of platform-ready posts, written in that specific client's voice — not generic AI copy.",
              tags: ["7 formats", "< 60s"],
              tagAccent: false,
            },
            {
              n: "03",
              title: "Approve, and it sharpens",
              body: "Every post you approve teaches the voice engine. The next episode comes back closer to perfect.",
              tags: ["voice +2% this week"],
              tagAccent: true,
            },
          ].map((step) => (
            <div key={step.n} style={{ background: "#FFFFFF", padding: "36px 30px" }}>
              <div
                className="mb-[26px] text-[13px] font-medium"
                style={{ fontFamily: "var(--font-mono)", color: "#3A5BA0" }}
              >
                {step.n}
              </div>
              <h3
                className="m-0 mb-[11px]"
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  fontSize: 20,
                  color: "#1A2A4A",
                  letterSpacing: "-0.02em",
                }}
              >
                {step.title}
              </h3>
              <p className="m-0 mb-5" style={{ fontSize: 15, lineHeight: 1.6, color: "#5A6473" }}>
                {step.body}
              </p>
              <div className="flex flex-wrap gap-[7px]">
                {step.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-md text-[11.5px] font-medium"
                    style={{
                      fontFamily: "var(--font-mono)",
                      color: step.tagAccent ? "#1F8A5B" : "#5A6473",
                      background: step.tagAccent ? "#EAF7F0" : "transparent",
                      border: step.tagAccent ? "none" : "1px solid #E4E8F0",
                      padding: "5px 10px",
                    }}
                  >
                    {t}
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

/* ============================================================
   Voice Engine
   ============================================================ */

function VoiceEngine() {
  return (
    <section
      id="voice"
      className="relative overflow-hidden px-7 py-[76px]"
      style={{ background: "#1A2A4A", borderBottom: "1px solid #1A2A4A" }}
    >
      <div
        className="pointer-events-none absolute"
        style={{
          top: "-140px",
          left: "-120px",
          width: 480,
          height: 480,
          borderRadius: "50%",
          background: "radial-gradient(circle,rgba(58,91,160,0.30) 0%,rgba(58,91,160,0) 70%)",
          animation: "floaty 9s ease-in-out infinite",
        }}
      />
      <svg
        className="pointer-events-none absolute"
        style={{ top: "-60px", right: "-60px", opacity: 0.5 }}
        width="360"
        height="360"
        viewBox="0 0 360 360"
        fill="none"
        stroke="#3A5BA0"
        strokeWidth="1"
      >
        <circle cx="180" cy="180" r="60" strokeOpacity="0.5" />
        <circle cx="180" cy="180" r="105" strokeOpacity="0.35" />
        <circle cx="180" cy="180" r="150" strokeOpacity="0.22" />
        <circle cx="180" cy="180" r="178" strokeOpacity="0.12" />
      </svg>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(#5B7FD0 0.8px, transparent 0.8px)",
          backgroundSize: "26px 26px",
          opacity: 0.04,
        }}
      />
      <div className="relative mx-auto" style={{ maxWidth: 1180 }}>
        <div className="mb-[38px]" style={{ maxWidth: 660 }}>
          <Kicker color="#7FA0E0">The Voice Engine</Kicker>
          <h2
            className="m-0"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 42,
              lineHeight: 1.08,
              letterSpacing: "-0.035em",
              color: "#FFFFFF",
              marginBottom: 18,
            }}
          >
            It learns each client, one approval at a time.
          </h2>
          <p
            className="m-0"
            style={{
              fontSize: "17.5px",
              lineHeight: 1.6,
              color: "#A9B6D4",
            }}
          >
            A separate voice model per client — trained on their words, their cadence, their pet
            phrases. The more you use it, the stronger the match.
          </p>
        </div>

        <ClientPicker />
      </div>
    </section>
  );
}

/* ============================================================
   Pillars
   ============================================================ */

function Pillars() {
  const pillars = [
    {
      title: "In your client's voice, not the AI's.",
      body: "Per-client voice models mean every post reads like the host wrote it — not like a chatbot. No more “make it sound human” passes.",
      icon: (
        <svg
          width="26"
          height="26"
          viewBox="0 0 26 26"
          fill="none"
          stroke="#3A5BA0"
          strokeWidth="1.6"
        >
          <circle cx="13" cy="13" r="3.5" />
          <circle cx="13" cy="13" r="8" />
          <circle cx="13" cy="13" r="12.2" strokeOpacity="0.4" />
        </svg>
      ),
    },
    {
      title: "Built for agencies, full stop.",
      body: "Manage every client from one place. White-label the output, route drafts through an approval workflow, and keep each voice walled off.",
      icon: (
        <svg
          width="26"
          height="26"
          viewBox="0 0 26 26"
          fill="none"
          stroke="#3A5BA0"
          strokeWidth="1.6"
        >
          <rect x="2" y="3" width="22" height="5" rx="1.5" />
          <rect x="2" y="10.5" width="22" height="5" rx="1.5" strokeOpacity="0.7" />
          <rect x="2" y="18" width="22" height="5" rx="1.5" strokeOpacity="0.4" />
        </svg>
      ),
    },
    {
      title: "Gets better the more you use it.",
      body: "Approvals feed straight back into the model. Month three takes a fraction of the edits month one did — and it compounds per client.",
      icon: (
        <svg
          width="26"
          height="26"
          viewBox="0 0 26 26"
          fill="none"
          stroke="#3A5BA0"
          strokeWidth="1.6"
        >
          <polyline points="2,20 9,13 14,17 24,5" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="17,5 24,5 24,12" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
  ];

  return (
    <section
      className="px-7 py-[72px]"
      style={{ background: "#FFFFFF", borderBottom: "1px solid #ECEEF3" }}
    >
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <div
          className="grid overflow-hidden"
          style={{
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 1,
            background: "#E8EBF1",
            border: "1px solid #E8EBF1",
            borderRadius: 14,
          }}
        >
          {pillars.map((p) => (
            <div key={p.title} style={{ background: "#FFFFFF", padding: "38px 32px" }}>
              <div style={{ marginBottom: 22 }}>{p.icon}</div>
              <h3
                className="m-0 mb-[11px]"
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  fontSize: 20,
                  color: "#1A2A4A",
                  letterSpacing: "-0.02em",
                }}
              >
                {p.title}
              </h3>
              <p className="m-0" style={{ fontSize: "14.5px", lineHeight: 1.62, color: "#5A6473" }}>
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   Outputs
   ============================================================ */

function Outputs() {
  const outputs = [
    { name: "X / Twitter thread", platform: "x.com", badge: "𝕏", color: "#000000" },
    { name: "LinkedIn post", platform: "linkedin", badge: "in", color: "#0A66C2" },
    { name: "Instagram caption", platform: "instagram", badge: "◎", color: "#C5318B" },
    { name: "TikTok script", platform: "tiktok", badge: "♪", color: "#111111" },
    { name: "Show notes", platform: "episode page", badge: "✎", color: "#3A5BA0" },
    { name: "Blog post", platform: "long-form", badge: "¶", color: "#1A2A4A" },
    { name: "Newsletter", platform: "email", badge: "✉", color: "#5B7FD0" },
  ];
  return (
    <section
      className="px-7 py-[72px]"
      style={{ background: "#FBFCFE", borderBottom: "1px solid #ECEEF3" }}
    >
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <div className="mb-9 flex flex-wrap items-end justify-between gap-6">
          <div style={{ maxWidth: 560 }}>
            <Kicker>Every output, every episode</Kicker>
            <H2>One transcript. Seven formats.</H2>
          </div>
          <div
            className="text-[15px] font-bold"
            style={{ fontFamily: "var(--font-display)", color: "#3A5BA0" }}
          >
            7× the output, one drop-in.
          </div>
        </div>
        <div className="grid gap-[14px]" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
          {outputs.map((o) => (
            <div
              key={o.name}
              className="flex items-center gap-[13px] transition-all hover:-translate-y-[2px]"
              style={{
                background: "#FFFFFF",
                border: "1px solid #E8EBF1",
                borderRadius: 12,
                padding: 22,
              }}
            >
              <span
                className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[9px] text-[14px] font-bold text-white"
                style={{ background: o.color }}
              >
                {o.badge}
              </span>
              <div>
                <div className="font-semibold" style={{ fontSize: "14.5px", color: "#1A2A4A" }}>
                  {o.name}
                </div>
                <div
                  className="mt-[2px] text-[11px]"
                  style={{ fontFamily: "var(--font-mono)", color: "#9AA3B2" }}
                >
                  {o.platform}
                </div>
              </div>
            </div>
          ))}
          <div
            className="flex flex-col justify-center"
            style={{ background: "#1A2A4A", borderRadius: 12, padding: 22 }}
          >
            <div
              className="font-bold"
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 15,
                color: "#FFFFFF",
                lineHeight: 1.4,
              }}
            >
              All written in the
              <br />
              client&apos;s voice.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   Social Proof
   ============================================================ */

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
      className="px-7 py-[72px]"
      style={{ background: "#FFFFFF", borderBottom: "1px solid #ECEEF3" }}
    >
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <div className="mb-10" style={{ maxWidth: 620 }}>
          <Kicker>From the studios using it</Kicker>
          <H2>Built to give contractor hours back.</H2>
        </div>
        <div
          className="grid overflow-hidden"
          style={{
            gridTemplateColumns: "repeat(3,1fr)",
            gap: 1,
            background: "#E8EBF1",
            border: "1px solid #E8EBF1",
            borderRadius: 14,
          }}
        >
          {testimonials.map((t) => (
            <div
              key={t.name}
              className="flex flex-col"
              style={{ background: "#FFFFFF", padding: "34px 30px" }}
            >
              <p
                className="m-0 flex-1"
                style={{
                  fontSize: 16,
                  lineHeight: 1.6,
                  color: "#1A2A4A",
                  marginBottom: 26,
                  letterSpacing: "-0.01em",
                }}
              >
                &ldquo;{t.quote}&rdquo;
              </p>
              <div className="flex items-center gap-3">
                <span
                  className="flex h-[42px] w-[42px] items-center justify-center rounded-full text-[14px] font-semibold text-white"
                  style={{
                    background: "#1A2A4A",
                    fontFamily: "var(--font-display)",
                  }}
                >
                  {t.initials}
                </span>
                <div>
                  <div className="text-[14.5px] font-semibold" style={{ color: "#1A2A4A" }}>
                    {t.name}
                  </div>
                  <div
                    className="mt-[2px] text-[11.5px]"
                    style={{ fontFamily: "var(--font-mono)", color: "#9AA3B2" }}
                  >
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

/* ============================================================
   Pricing
   ============================================================ */

function Pricing({ isSignedIn }: { isSignedIn: boolean }) {
  const ctaLabel = isSignedIn ? "Open dashboard" : "Start free";
  const ctaHref = isSignedIn ? "/dashboard" : "/sign-up";
  const plans = [
    {
      name: "Studio",
      tagline: "For solo operators getting started.",
      price: "$99",
      cta: ctaLabel,
      ctaStyle: "ghost" as const,
      features: ["3 client shows", "2 seats", "All 7 output formats", "Per-client voice engine"],
      tone: "light" as const,
    },
    {
      name: "Agency",
      tagline: "For studios running a roster of clients.",
      price: "$249",
      cta: ctaLabel,
      ctaStyle: "white" as const,
      features: [
        "10 client shows",
        "5 seats",
        "White-label output",
        "Approval workflow",
        "Everything in Studio",
      ],
      tone: "dark" as const,
      badge: "Most popular",
    },
    {
      name: "Network",
      tagline: "For multi-studio networks at scale.",
      price: "$499",
      cta: ctaLabel,
      ctaStyle: "ghost" as const,
      features: [
        "25 client shows",
        "Unlimited seats",
        "Batch processing",
        "Priority generation",
        "Everything in Agency",
      ],
      tone: "light" as const,
    },
  ];

  return (
    <section
      id="pricing"
      className="px-7 py-[72px]"
      style={{ background: "#FBFCFE", borderBottom: "1px solid #ECEEF3" }}
    >
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <div className="mb-10 text-center">
          <Kicker>Pricing</Kicker>
          <H2>Priced per studio, not per post.</H2>
          <p className="m-0 mt-3 text-[16px]" style={{ color: "#5A6473" }}>
            One episode of saved contractor time usually covers the month.
          </p>
        </div>
        <div
          className="grid items-stretch gap-[18px]"
          style={{ gridTemplateColumns: "repeat(3,1fr)" }}
        >
          {plans.map((p) => {
            const dark = p.tone === "dark";
            const textColor = dark ? "#FFFFFF" : "#1A2A4A";
            const subColor = dark ? "#A9B6D4" : "#9AA3B2";
            const featColor = dark ? "#E8EDF6" : "#2A3445";
            const arrowColor = dark ? "#7FE3B0" : "#3A5BA0";
            return (
              <div
                key={p.name}
                className="relative"
                style={{
                  background: dark ? "#1A2A4A" : "#FFFFFF",
                  border: dark ? "none" : "1px solid #E4E8F0",
                  borderRadius: 16,
                  padding: 32,
                  boxShadow: dark ? "0 30px 60px -30px rgba(26,42,74,0.5)" : "none",
                }}
              >
                {p.badge && (
                  <span
                    className="absolute top-6 right-6 rounded-md text-[10.5px] font-medium uppercase"
                    style={{
                      fontFamily: "var(--font-mono)",
                      letterSpacing: "0.06em",
                      color: "#1A2A4A",
                      background: "#7FE3B0",
                      padding: "5px 10px",
                    }}
                  >
                    {p.badge}
                  </span>
                )}
                <div
                  className="text-[17px] font-semibold"
                  style={{ fontFamily: "var(--font-display)", color: textColor }}
                >
                  {p.name}
                </div>
                <p
                  className="m-0 mt-[6px] text-[13.5px]"
                  style={{ color: subColor, marginBottom: 22 }}
                >
                  {p.tagline}
                </p>
                <div className="mb-[22px] flex items-baseline gap-1">
                  <span
                    className="font-bold"
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: 42,
                      color: textColor,
                      letterSpacing: "-0.03em",
                    }}
                  >
                    {p.price}
                  </span>
                  <span className="text-[14px]" style={{ color: subColor }}>
                    /mo
                  </span>
                </div>
                <Link
                  href={ctaHref}
                  className="mb-[26px] block rounded-[9px] text-center text-[14px] font-medium no-underline"
                  style={{
                    background: p.ctaStyle === "white" ? "#FFFFFF" : dark ? "#1A2A4A" : "#FFFFFF",
                    color: p.ctaStyle === "white" ? "#1A2A4A" : "#1A2A4A",
                    border: p.ctaStyle === "ghost" ? "1px solid #DDE2EC" : "none",
                    padding: 12,
                  }}
                >
                  {p.cta}
                </Link>
                <div className="flex flex-col gap-[13px]">
                  {p.features.map((f) => (
                    <div
                      key={f}
                      className="flex gap-[11px] text-[14px]"
                      style={{ color: featColor }}
                    >
                      <span style={{ color: arrowColor }}>→</span> {f}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   FAQ
   ============================================================ */

function FAQ() {
  return (
    <section
      id="faq"
      className="px-7 py-[72px]"
      style={{ background: "#FFFFFF", borderBottom: "1px solid #ECEEF3" }}
    >
      <div
        className="mx-auto grid items-start gap-14"
        style={{ maxWidth: 860, gridTemplateColumns: "0.7fr 1.3fr" }}
      >
        <div>
          <Kicker>FAQ</Kicker>
          <H2 size={34}>Questions, answered.</H2>
        </div>
        <FAQAccordion />
      </div>
    </section>
  );
}

/* ============================================================
   Final CTA
   ============================================================ */

function FinalCTA({ isSignedIn }: { isSignedIn: boolean }) {
  const bandSeed = [
    8, 16, 11, 22, 14, 28, 12, 19, 26, 10, 18, 30, 13, 24, 9, 20, 15, 27, 11, 21, 17, 29, 12, 23, 8,
    18, 25, 14, 31, 10, 19, 13, 26, 16, 9, 22, 12, 28, 15, 20, 11, 24, 8, 17, 30, 13, 21, 9, 18, 27,
  ];
  return (
    <section className="relative overflow-hidden px-7 py-[68px]" style={{ background: "#1A2A4A" }}>
      <div
        className="pointer-events-none absolute inset-0 flex items-center gap-[5px] px-7"
        style={{ opacity: 0.1 }}
      >
        {bandSeed.map((h, i) => (
          <span
            key={i}
            style={{
              flex: 1,
              height: 30 + h * 2.4,
              borderRadius: 2,
              background: "#5B7FD0",
              transformOrigin: "center",
              animation: "eq 1.4s ease-in-out infinite",
              animationDelay: `${((i % 11) * 0.09).toFixed(2)}s`,
            }}
          />
        ))}
      </div>
      <div
        className="relative mx-auto grid items-center gap-10"
        style={{ maxWidth: 1180, gridTemplateColumns: "1fr auto" }}
      >
        <div>
          <h2
            className="m-0"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 40,
              lineHeight: 1.08,
              letterSpacing: "-0.035em",
              color: "#FFFFFF",
              marginBottom: 16,
            }}
          >
            Give the rewriting back to the machine.
          </h2>
          <p
            className="m-0"
            style={{
              fontSize: 17,
              color: "#A9B6D4",
              maxWidth: 520,
              lineHeight: 1.6,
            }}
          >
            Start free, connect your first show, and watch one transcript become a week of content —
            in your client&apos;s voice.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isSignedIn ? (
            <Link
              href="/dashboard"
              className="rounded-[9px] text-[15px] font-medium whitespace-nowrap no-underline"
              style={{ background: "#FFFFFF", color: "#1A2A4A", padding: "14px 26px" }}
            >
              Open dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/sign-up"
                className="rounded-[9px] text-[15px] font-medium whitespace-nowrap no-underline"
                style={{ background: "#FFFFFF", color: "#1A2A4A", padding: "14px 26px" }}
              >
                Start free
              </Link>
              <Link
                href="/sign-in"
                className="rounded-[9px] text-[15px] font-medium whitespace-nowrap no-underline"
                style={{
                  background: "rgba(255,255,255,0.1)",
                  color: "#FFFFFF",
                  padding: "14px 26px",
                  border: "1px solid rgba(255,255,255,0.2)",
                }}
              >
                Sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   Footer
   ============================================================ */

function Footer() {
  const columns = [
    {
      title: "Product",
      links: [
        { label: "Voice Engine", href: "#voice" },
        { label: "How it works", href: "#how" },
        { label: "Pricing", href: "#pricing" },
        { label: "Integrations", href: "#" },
      ],
    },
    {
      title: "Company",
      links: [
        { label: "About", href: "#" },
        { label: "Blog", href: "#" },
        { label: "Careers", href: "#" },
        { label: "Contact", href: "#" },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "Privacy", href: "#" },
        { label: "Terms", href: "#" },
        { label: "Security", href: "#" },
      ],
    },
  ];

  return (
    <footer className="px-7" style={{ background: "#13203B", padding: "56px 28px 38px" }}>
      <div className="mx-auto" style={{ maxWidth: 1180 }}>
        <div
          className="grid gap-10 pb-[42px]"
          style={{
            gridTemplateColumns: "1.6fr 1fr 1fr 1fr",
            borderBottom: "1px solid #2A3C60",
          }}
        >
          <div>
            <div className="mb-[14px]">
              <BrandMark darkBg />
            </div>
            <p
              className="m-0 text-[13.5px]"
              style={{ color: "#8794B5", lineHeight: 1.6, maxWidth: 280 }}
            >
              Platform-ready content from every client episode — in their voice, sharper every time.
            </p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <div
                className="mb-4 text-[11px] font-medium uppercase"
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "#6B7BA3",
                  letterSpacing: "0.06em",
                }}
              >
                {col.title}
              </div>
              <div className="flex flex-col gap-[11px] text-[13.5px]">
                {col.links.map((l) => (
                  <a
                    key={l.label}
                    href={l.href}
                    className="no-underline transition-colors hover:text-white"
                    style={{ color: "#A9B6D4" }}
                  >
                    {l.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <span
            className="text-[12px]"
            style={{ fontFamily: "var(--font-mono)", color: "#6B7BA3" }}
          >
            © 2026 Repodcast, Inc.
          </span>
          <span
            className="text-[12px]"
            style={{ fontFamily: "var(--font-mono)", color: "#6B7BA3" }}
          >
            Made for the studios doing the work.
          </span>
        </div>
      </div>
    </footer>
  );
}
