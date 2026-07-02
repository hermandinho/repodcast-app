import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { CONTACT_EMAILS } from "@/lib/contact-emails";

/**
 * `/contact` — one landing spot for every inbound path. No form: mailtos
 * convert better for B2B, avoid a spam vector, and — importantly —
 * inbound goes straight to the mailbox that owns the topic.
 *
 * Addresses come from `lib/contact-emails.ts` so an alias change doesn't
 * require touching this file.
 */

export const metadata: Metadata = {
  title: "Contact — Repodcast",
  description:
    "How to reach us — sales, support, privacy, security, legal — plus where to report abusive content.",
};

type Card = {
  label: string;
  email: string;
  blurb: string;
  responseHint: string;
};

export default async function ContactPage() {
  const { userId } = await auth();
  const isSignedIn = !!userId;

  const cards: Card[] = [
    {
      label: "Sales & general questions",
      email: CONTACT_EMAILS.hello,
      blurb:
        "Curious whether Repodcast fits your agency? Want a walkthrough, a scoped pilot, or the answer to a question the site doesn't cover?",
      responseHint: "Usually a same-day reply on business days.",
    },
    {
      label: "Product support",
      email: CONTACT_EMAILS.support,
      blurb:
        "Something broken, confusing, or slower than it should be? Please include the workspace name, the client if it's client-scoped, and a screenshot or URL if you have one.",
      responseHint: "First response within one business day.",
    },
    {
      label: "Privacy & data requests",
      email: CONTACT_EMAILS.privacy,
      blurb:
        "Access, export, correction, or deletion requests — from you or from a data subject you're routing on behalf of. See our Privacy Policy for what we hold and how long.",
      responseHint: "Response within 30 days, faster where required by law.",
    },
    {
      label: "Security",
      email: CONTACT_EMAILS.security,
      blurb:
        "Report a suspected vulnerability, ask a security question, or request a data-processing addendum or vendor questionnaire.",
      responseHint: "Acknowledgement within two business days.",
    },
    {
      label: "Legal notices",
      email: CONTACT_EMAILS.legal,
      blurb:
        "Formal legal notices, DMCA claims that require a specific legal contact, and business-legal correspondence.",
      responseHint: "Time-sensitive claims routed same day.",
    },
  ];

  return (
    <div className="w-full overflow-x-hidden">
      <LandingNav isSignedIn={isSignedIn} />
      <main style={{ background: "#FBFCFE" }}>
        <div className="mx-auto px-7" style={{ maxWidth: 900, paddingTop: 72, paddingBottom: 96 }}>
          <p
            className="m-0 text-[11px] font-medium uppercase"
            style={{
              fontFamily: "var(--font-mono)",
              color: "#6B7BA3",
              letterSpacing: "0.1em",
            }}
          >
            Contact
          </p>
          <h1
            className="mt-3 mb-4 text-[42px] leading-[1.1] font-semibold"
            style={{
              fontFamily: "var(--font-display)",
              color: "#1A2A4A",
              letterSpacing: "-0.02em",
            }}
          >
            Get in touch.
          </h1>
          <p
            className="m-0 text-[16.5px]"
            style={{ color: "#5A6473", lineHeight: 1.7, maxWidth: 640 }}
          >
            Pick the mailbox that fits — messages route straight to the person who owns that area,
            not into a shared inbox that nobody watches.
          </p>

          <div
            className="mt-12 grid gap-5"
            style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}
          >
            {cards.map((card) => (
              <ContactCard key={card.email} card={card} />
            ))}
            <AbuseCard />
          </div>

          <p className="mt-10 text-[13.5px]" style={{ color: "#6B7BA3", lineHeight: 1.6 }}>
            Prefer to read first?{" "}
            <Link
              href="/legal/privacy"
              style={{ color: "#3A5BA0", textDecoration: "underline", textUnderlineOffset: 3 }}
            >
              Privacy
            </Link>
            ,{" "}
            <Link
              href="/legal/terms"
              style={{ color: "#3A5BA0", textDecoration: "underline", textUnderlineOffset: 3 }}
            >
              Terms
            </Link>
            , and{" "}
            <Link
              href="/legal/security"
              style={{ color: "#3A5BA0", textDecoration: "underline", textUnderlineOffset: 3 }}
            >
              Security
            </Link>{" "}
            answer most of what companies ask before writing to us.
          </p>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}

function ContactCard({ card }: { card: Card }) {
  return (
    <div
      className="flex flex-col rounded-2xl p-6"
      style={{
        background: "#FFFFFF",
        border: "1px solid #ECEEF3",
        boxShadow: "0 1px 2px rgba(26,42,74,0.03)",
      }}
    >
      <p
        className="m-0 text-[11px] font-medium uppercase"
        style={{
          fontFamily: "var(--font-mono)",
          color: "#6B7BA3",
          letterSpacing: "0.08em",
        }}
      >
        {card.label}
      </p>
      <p
        className="mt-4 text-[14.5px]"
        style={{ color: "#3D4A63", lineHeight: 1.65, margin: "12px 0 0" }}
      >
        {card.blurb}
      </p>
      <div
        className="mt-5 flex flex-wrap items-center justify-between gap-2 pt-4"
        style={{ borderTop: "1px solid #F0F3F8" }}
      >
        <a
          href={`mailto:${card.email}`}
          className="text-[14.5px] font-medium no-underline"
          style={{
            color: "#1A2A4A",
            fontFamily: "var(--font-mono)",
          }}
        >
          {card.email}
        </a>
        <span
          className="text-[11.5px]"
          style={{ fontFamily: "var(--font-mono)", color: "#8794B5" }}
        >
          {card.responseHint}
        </span>
      </div>
    </div>
  );
}

function AbuseCard() {
  return (
    <div
      className="flex flex-col rounded-2xl p-6"
      style={{
        background: "#FFF8F0",
        border: "1px solid #F3DFC2",
        boxShadow: "0 1px 2px rgba(26,42,74,0.03)",
      }}
    >
      <p
        className="m-0 text-[11px] font-medium uppercase"
        style={{
          fontFamily: "var(--font-mono)",
          color: "#8A6B36",
          letterSpacing: "0.08em",
        }}
      >
        Report abuse
      </p>
      <p
        className="mt-4 text-[14.5px]"
        style={{ color: "#5A4A2E", lineHeight: 1.65, margin: "12px 0 0" }}
      >
        Copyright infringement, impersonation, harassment, or spam involving content created or
        shared through Repodcast? Use the report form — it goes into our operator triage queue
        instead of an inbox.
      </p>
      <div
        className="mt-5 flex flex-wrap items-center justify-between gap-2 pt-4"
        style={{ borderTop: "1px solid #F3DFC2" }}
      >
        <Link
          href="/legal/report"
          className="text-[14.5px] font-medium no-underline"
          style={{ color: "#7A5A20", fontFamily: "var(--font-mono)" }}
        >
          /legal/report
        </Link>
        <span
          className="text-[11.5px]"
          style={{ fontFamily: "var(--font-mono)", color: "#B08850" }}
        >
          Reviewed by an operator, every submission.
        </span>
      </div>
    </div>
  );
}
