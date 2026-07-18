import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@clerk/nextjs/server";
import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { CONTACT_EMAILS } from "@/lib/contact-emails";
import { SupportForm } from "./support-form";

/**
 * `/contact` — a real support form on top for the "product support"
 * conversation, with the specialised mailboxes (sales, privacy, security,
 * legal, abuse) still accessible below. The form writes a durable
 * `SupportTicket` row + mails `CONTACT_EMAILS.support`; Cloudflare
 * Turnstile gates the write against bots. See
 * `submitSupportTicketAction` for the server side.
 */

export const metadata: Metadata = {
  title: "Contact — Repodcast",
  description:
    "Send us a support ticket, or reach the right team directly — sales, privacy, security, legal, or abuse reports.",
  alternates: {
    canonical: "/contact",
  },
};

type Card = {
  label: string;
  email: string;
  blurb: string;
  responseHint: string;
};

export default async function ContactPage() {
  // We tolerate a failed lookup — /contact must render even if Clerk is
  // in a bad way. `currentUser()` throws on 5xx; we swallow to a null
  // prefill.
  const user = await currentUser().catch(() => null);
  const isSignedIn = !!user;
  const initialName = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || "";
  const initialEmail = user?.primaryEmailAddress?.emailAddress ?? "";

  const otherChannels: Card[] = [
    {
      label: "Sales & general questions",
      email: CONTACT_EMAILS.hello,
      blurb:
        "Walkthroughs, pilots, or questions the site doesn't cover. If you're not sure it fits, we'll tell you.",
      responseHint: "Usually same-day on business days.",
    },
    {
      label: "Privacy & data requests",
      email: CONTACT_EMAILS.privacy,
      blurb:
        "Access, export, correction, or deletion requests — from you or from a data subject you're routing.",
      responseHint: "Response within 30 days.",
    },
    {
      label: "Security",
      email: CONTACT_EMAILS.security,
      blurb: "Report a suspected vulnerability, or request a DPA or vendor questionnaire.",
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
        <div
          className="mx-auto px-5 pt-12 pb-16 sm:px-7 sm:pt-16 sm:pb-24 md:pt-[72px] md:pb-24"
          style={{ maxWidth: 900 }}
        >
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
            className="mt-3 mb-4 text-[32px] leading-[1.1] font-semibold sm:text-[38px] md:text-[42px]"
            style={{
              fontFamily: "var(--font-display)",
              color: "#1A2A4A",
              letterSpacing: "-0.02em",
            }}
          >
            Get in touch.
          </h1>
          <p
            className="m-0 text-[15px] sm:text-[16.5px]"
            style={{ color: "#5A6473", lineHeight: 1.7, maxWidth: 640 }}
          >
            Send a support ticket below and a human will get back to you. If you&rsquo;d rather
            route directly to sales, privacy, security, or legal, the specialist mailboxes are just
            under the form.
          </p>

          <div className="mt-10 sm:mt-12">
            <SupportForm
              initialName={initialName}
              initialEmail={initialEmail}
              isSignedIn={isSignedIn}
            />
          </div>

          <h2
            className="mt-14 mb-2 text-[18px] font-semibold sm:text-[20px]"
            style={{
              fontFamily: "var(--font-display)",
              color: "#1A2A4A",
              letterSpacing: "-0.01em",
            }}
          >
            Prefer a specialist mailbox?
          </h2>
          <p className="m-0 text-[14px]" style={{ color: "#5A6473", lineHeight: 1.65 }}>
            These go straight to the person who owns that area — not into a shared inbox.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
            {otherChannels.map((card) => (
              <ContactCard key={card.email} card={card} />
            ))}
            <AbuseCard />
          </div>

          <p className="mt-8 text-[13.5px] sm:mt-10" style={{ color: "#6B7BA3", lineHeight: 1.6 }}>
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
