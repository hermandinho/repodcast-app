import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { CONTACT_EMAILS } from "@/lib/contact-emails";

/**
 * `/about` — first-draft company page. Deliberately product-focused: no
 * invented founder narrative, no team roster, no aspirational commitments
 * we can't keep. Every claim on this page tracks a control that exists
 * elsewhere in the codebase (voice profiles per client, no third-party
 * model training, etc.). Update as those controls evolve.
 */

export const metadata: Metadata = {
  title: "About — Repodcast",
  description:
    "Repodcast turns every episode into a full launch kit — posts, clips, artwork, and audiograms — in your client's voice. Built for podcast agencies.",
};

export default async function AboutPage() {
  const { userId } = await auth();
  const isSignedIn = !!userId;

  return (
    <div className="w-full overflow-x-hidden">
      <LandingNav isSignedIn={isSignedIn} />
      <Hero />
      <WhatWeDo />
      <WhoItsFor />
      <VoiceTrue />
      <Commitments />
      <FinalCTA isSignedIn={isSignedIn} />
      <LandingFooter />
    </div>
  );
}

/* ============================================================
   Hero
   ============================================================ */

function Hero() {
  return (
    <section
      className="relative overflow-hidden"
      style={{
        background: "linear-gradient(180deg,#fff 0%,#FBFCFE 100%)",
        borderBottom: "1px solid #ECEEF3",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(#1A2A4A 0.8px, transparent 0.8px)",
          backgroundSize: "24px 24px",
          opacity: 0.035,
        }}
      />
      <div
        className="relative mx-auto px-7"
        style={{ maxWidth: 900, paddingTop: 92, paddingBottom: 72 }}
      >
        <p
          className="m-0 text-[11px] font-medium uppercase"
          style={{
            fontFamily: "var(--font-mono)",
            color: "#6B7BA3",
            letterSpacing: "0.1em",
          }}
        >
          About Repodcast
        </p>
        <h1
          className="mt-4 text-[52px] leading-[1.05] font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            color: "#1A2A4A",
            letterSpacing: "-0.025em",
            maxWidth: 780,
          }}
        >
          Made for the studios doing the work.
        </h1>
        <p
          className="mt-6 text-[18px]"
          style={{ color: "#5A6473", lineHeight: 1.65, maxWidth: 640 }}
        >
          Repodcast turns every client episode into a full launch kit — seven written posts,
          vertical clips, hero artwork, and audiograms — all in your client&rsquo;s exact voice,
          ready to publish in a minute. Built for the podcast agencies quietly producing at scale.
        </p>
      </div>
    </section>
  );
}

/* ============================================================
   What we do
   ============================================================ */

function WhatWeDo() {
  return (
    <Section
      eyebrow="What Repodcast is"
      title="A full launch kit per episode — in each client's voice."
    >
      <p>
        One transcript becomes seven written posts across every social platform, vertical clips with
        captions burned in, hero artwork in three aspect ratios, and audiograms ready to attach to
        each post. The whole set — text, video, image, and audio deliverables — lands in the same
        folder, in a minute.
      </p>
      <p>
        The catch every other tool hits is the voice. Generic AI produces the same beige LinkedIn
        post you&rsquo;ve read a hundred times this week. Repodcast builds a voice-style profile per
        client, and every output — thread, caption, clip caption, show note — is generated against{" "}
        <em>that specific voice</em>. Approvals teach it what&rsquo;s right; edits teach it what to
        fix. Episode two sounds sharper than episode one, and episode ten sounds like your client
        wrote it at their best.
      </p>
    </Section>
  );
}

/* ============================================================
   Who it's for
   ============================================================ */

function WhoItsFor() {
  return (
    <Section eyebrow="Who Repodcast is for" title="Agencies with more shows than time." tone="cool">
      <p>
        If you produce podcasts for three, thirty, or three hundred clients and every episode still
        needs a human to sit down and write posts in that host&rsquo;s voice, Repodcast is built for
        you. Independent producers use it too, but the workflow — separate client workspaces,
        per-client voice profiles, per-client billing — is designed for the agency shape.
      </p>
      <p>
        We&rsquo;re not for solo hobbyists posting once a month. And we&rsquo;re not a Zapier-glued
        generic AI wrapper. If your clients pay you specifically because they sound like themselves
        everywhere, we&rsquo;re on the right team.
      </p>
    </Section>
  );
}

/* ============================================================
   Voice-true philosophy
   ============================================================ */

function VoiceTrue() {
  return (
    <Section eyebrow="Why voice-true" title="The moat is sounding like the person.">
      <p>
        AI made it trivial to produce &ldquo;a post about last week&rsquo;s episode.&rdquo; It also
        made those posts indistinguishable — same rhythm, same three-em-dash paragraphs, same soft
        insights. Audiences learn to skip them within a week.
      </p>
      <p>
        The thing that keeps working is the host&rsquo;s actual voice. Their rhythm. Their
        pet-phrases. The joke they make when the guest says something obvious. That&rsquo;s not a
        style; that&rsquo;s the person. Every design decision in Repodcast is a bet that
        voice-fidelity is the durable advantage — for your clients, and therefore for you.
      </p>
    </Section>
  );
}

/* ============================================================
   Commitments
   ============================================================ */

function Commitments() {
  const items: Array<{ title: string; body: string }> = [
    {
      title: "Your content stays yours.",
      body: "We do not train third-party foundation models on your audio, transcripts, or generated outputs. Our AI vendors are contracted to process what we send only to return the requested result.",
    },
    {
      title: "Voice profiles are scoped to one client.",
      body: "A voice profile for one of your clients cannot be viewed, borrowed, or leaked into another agency's workspace. The isolation is enforced at the query layer, not just at the UI.",
    },
    {
      title: "You can leave with everything.",
      body: "Export tools are always on. If Repodcast stops being right for your agency, take your transcripts, your outputs, and your voice-style records with you.",
    },
    {
      title: "We're honest about what we don't have.",
      body: "Our Security page lists the certifications we hold and the ones we don't. If your procurement needs something we can't offer today, we'll say so up front.",
    },
  ];
  return (
    <section style={{ background: "#F7F9FC", borderTop: "1px solid #ECEEF3" }}>
      <div className="mx-auto px-7" style={{ maxWidth: 900, paddingTop: 84, paddingBottom: 84 }}>
        <p
          className="m-0 text-[11px] font-medium uppercase"
          style={{
            fontFamily: "var(--font-mono)",
            color: "#6B7BA3",
            letterSpacing: "0.1em",
          }}
        >
          What we won&rsquo;t do
        </p>
        <h2
          className="mt-3 text-[30px] leading-[1.15] font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            color: "#1A2A4A",
            letterSpacing: "-0.02em",
            maxWidth: 640,
          }}
        >
          Four commitments we&rsquo;re accountable to.
        </h2>
        <ul className="mt-10 grid gap-6" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
          {items.map((item) => (
            <li
              key={item.title}
              className="rounded-2xl p-6"
              style={{
                background: "#FFFFFF",
                border: "1px solid #ECEEF3",
                boxShadow: "0 1px 2px rgba(26,42,74,0.03)",
              }}
            >
              <h3
                className="m-0 text-[16px] font-semibold"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "#1A2A4A",
                  letterSpacing: "-0.005em",
                }}
              >
                {item.title}
              </h3>
              <p
                className="mt-2 text-[14.5px]"
                style={{ color: "#5A6473", lineHeight: 1.65, margin: "8px 0 0" }}
              >
                {item.body}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-[13.5px]" style={{ color: "#5A6473", lineHeight: 1.6 }}>
          Read the fine print: <Link href="/legal/privacy">Privacy</Link>,{" "}
          <Link href="/legal/terms">Terms</Link>, <Link href="/legal/security">Security</Link>. Or
          write to{" "}
          <a
            href={`mailto:${CONTACT_EMAILS.hello}`}
            style={{ color: "#3A5BA0", textDecoration: "underline", textUnderlineOffset: 3 }}
          >
            {CONTACT_EMAILS.hello}
          </a>{" "}
          — we answer.
        </p>
      </div>
    </section>
  );
}

/* ============================================================
   Final CTA
   ============================================================ */

function FinalCTA({ isSignedIn }: { isSignedIn: boolean }) {
  return (
    <section style={{ background: "#FFFFFF", borderTop: "1px solid #ECEEF3" }}>
      <div
        className="mx-auto px-7 text-center"
        style={{ maxWidth: 720, paddingTop: 88, paddingBottom: 88 }}
      >
        <h2
          className="m-0 text-[34px] leading-[1.15] font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            color: "#1A2A4A",
            letterSpacing: "-0.02em",
          }}
        >
          Ready to hear it in your client&rsquo;s voice?
        </h2>
        <p
          className="mx-auto mt-4 text-[16px]"
          style={{ color: "#5A6473", lineHeight: 1.6, maxWidth: 520 }}
        >
          Start on any plan — the full launch kit (posts, clips, artwork, audiograms), the voice
          engine, and per-client workspaces are included from the first minute.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href={isSignedIn ? "/after-sign-in" : "/pricing"}
            className="rounded-lg text-[15px] font-medium no-underline"
            style={{
              background: "#1A2A4A",
              color: "#FFFFFF",
              padding: "12px 22px",
            }}
          >
            {isSignedIn ? "Continue" : "See pricing"}
          </Link>
          <Link
            href="/contact"
            className="rounded-lg text-[15px] font-medium no-underline"
            style={{
              background: "transparent",
              color: "#1A2A4A",
              padding: "12px 22px",
              border: "1px solid #D9DFEB",
            }}
          >
            Talk to us
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   Shared section helper
   ============================================================ */

function Section({
  eyebrow,
  title,
  tone = "warm",
  children,
}: {
  eyebrow: string;
  title: string;
  tone?: "warm" | "cool";
  children: React.ReactNode;
}) {
  const background = tone === "cool" ? "#FBFCFE" : "#FFFFFF";
  return (
    <section style={{ background, borderTop: "1px solid #ECEEF3" }}>
      <div className="mx-auto px-7" style={{ maxWidth: 900, paddingTop: 84, paddingBottom: 84 }}>
        <p
          className="m-0 text-[11px] font-medium uppercase"
          style={{
            fontFamily: "var(--font-mono)",
            color: "#6B7BA3",
            letterSpacing: "0.1em",
          }}
        >
          {eyebrow}
        </p>
        <h2
          className="mt-3 text-[30px] leading-[1.15] font-semibold"
          style={{
            fontFamily: "var(--font-display)",
            color: "#1A2A4A",
            letterSpacing: "-0.02em",
            maxWidth: 640,
          }}
        >
          {title}
        </h2>
        <div
          className="mt-6 flex flex-col gap-4 text-[16px]"
          style={{ color: "#3D4A63", lineHeight: 1.72, maxWidth: 680 }}
        >
          {children}
        </div>
      </div>
    </section>
  );
}
