import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { LegalPageLayout } from "@/components/legal/legal-page-layout";
import { CONTACT_EMAILS } from "@/lib/contact-emails";

/**
 * First-draft Privacy Policy. Written to reflect current product reality
 * (Clerk auth, Stripe billing, Deepgram transcription, Anthropic
 * generation, S3 storage, PostHog analytics, Resend email) — needs
 * counsel review before public launch. Update `LAST_UPDATED` whenever the
 * substance changes so the "Last updated" stamp is honest.
 */

const LAST_UPDATED = "July 2, 2026";

export const metadata: Metadata = {
  title: "Privacy — Repodcast",
  description:
    "How Repodcast collects, uses, stores, and shares the personal data of agencies, their clients, and their audiences.",
};

export default async function PrivacyPage() {
  const { userId } = await auth();

  return (
    <LegalPageLayout
      isSignedIn={!!userId}
      eyebrow="Legal"
      title="Privacy Policy"
      intro="This policy explains what personal data Repodcast collects, why we collect it, how long we keep it, and the choices you and your clients have."
      lastUpdated={LAST_UPDATED}
    >
      <h2 id="who-we-are">1. Who we are</h2>
      <p>
        Repodcast is a business-to-business platform built for podcast agencies. Our customer
        (&ldquo;<strong>you</strong>&rdquo;) is the agency operating a Repodcast workspace. The
        agency&rsquo;s own clients (the podcasters and brands they serve) and the audiences those
        podcasts reach may also appear in the data we handle — this policy covers all three.
      </p>
      <p>
        If you have privacy questions, reach us at{" "}
        <a href={`mailto:${CONTACT_EMAILS.privacy}`}>{CONTACT_EMAILS.privacy}</a>.
      </p>

      <h2 id="data-we-collect">2. Data we collect</h2>

      <h3>2.1 Account and workspace data</h3>
      <p>
        When you sign up we collect the name, email address, profile image, and authentication
        identifiers your identity provider gives us (see <a href="#subprocessors">Section 8</a> —
        authentication runs through Clerk). We also record the workspace, role, and permissions you
        hold inside Repodcast.
      </p>

      <h3>2.2 Billing data</h3>
      <p>
        Paid plans are handled by Stripe. Repodcast does <strong>not</strong> store card numbers or
        bank details — we only retain the customer ID, subscription state, plan, and invoice history
        Stripe returns to us.
      </p>

      <h3>2.3 Content you upload or generate</h3>
      <ul>
        <li>
          Audio files, RSS URLs, and YouTube links you submit for transcription and generation.
        </li>
        <li>Transcripts produced by our transcription provider.</li>
        <li>
          Voice-style profiles derived from your client&rsquo;s prior writing and approved episodes.
        </li>
        <li>
          Generated outputs (X threads, LinkedIn posts, show notes, etc.) and any edits or approvals
          you make on them.
        </li>
      </ul>
      <p>
        This content may include personal information about your clients, guests, or third parties
        mentioned in an episode. You are responsible for having a lawful basis to submit it — see{" "}
        <a href="#your-responsibilities">Section 6</a>.
      </p>

      <h3>2.4 Product and diagnostic data</h3>
      <p>
        We log pages viewed, features used, buttons clicked, request timings, and error stack traces
        so we can improve reliability and troubleshoot issues. Product analytics runs through
        PostHog with IP anonymisation enabled. We do not sell this data.
      </p>

      <h3>2.5 Support communications</h3>
      <p>
        Emails you send to <a href={`mailto:${CONTACT_EMAILS.hello}`}>{CONTACT_EMAILS.hello}</a>,{" "}
        <a href={`mailto:${CONTACT_EMAILS.support}`}>{CONTACT_EMAILS.support}</a>,{" "}
        <a href={`mailto:${CONTACT_EMAILS.privacy}`}>{CONTACT_EMAILS.privacy}</a>, or{" "}
        <a href={`mailto:${CONTACT_EMAILS.legal}`}>{CONTACT_EMAILS.legal}</a> are retained for as
        long as needed to resolve the matter and demonstrate that we did.
      </p>

      <h2 id="how-we-use-data">3. How we use data</h2>
      <ul>
        <li>
          <strong>To operate the service</strong> — authenticate you, run the workspace you belong
          to, transcribe audio, generate content in your client&rsquo;s voice, deliver approved
          content to platforms you connect.
        </li>
        <li>
          <strong>To bill you</strong> — meter usage against your plan and process payments through
          Stripe.
        </li>
        <li>
          <strong>To keep the service safe and reliable</strong> — detect abuse, prevent fraud,
          triage security incidents, respond to <Link href="/legal/report">abuse reports</Link>.
        </li>
        <li>
          <strong>To improve the product</strong> — measure feature adoption, diagnose failures,
          evaluate model quality. Where we use content to evaluate voice-fidelity, we do so under
          strict internal access controls; we do not train third-party foundation models on your
          content (see <a href="#ai-content">Section 5</a>).
        </li>
        <li>
          <strong>To communicate with you</strong> — service notices, security alerts, and
          product-relevant updates. Marketing emails, when we send them, always include a one-click
          unsubscribe.
        </li>
      </ul>

      <h2 id="lawful-basis">4. Lawful basis (EEA/UK)</h2>
      <p>
        Where GDPR applies we rely on one of the following: performance of the contract with your
        agency, our legitimate interest in operating and securing the service, your consent (for
        optional cookies and marketing email), or compliance with a legal obligation.
      </p>

      <h2 id="ai-content">5. AI, model training, and voice profiles</h2>
      <p>
        Repodcast uses third-party AI providers to transcribe audio (Deepgram) and generate content
        (Anthropic). Those providers process your content <em>only</em> to return the requested
        output — under our commercial agreements, your content is not used to train their public
        foundation models.
      </p>
      <p>
        Voice-style profiles are derived from content the agency has uploaded or approved for a
        specific client and are scoped to that client&rsquo;s workspace. They are not shared across
        agencies or clients.
      </p>

      <h2 id="your-responsibilities">6. Your responsibilities as the agency</h2>
      <ul>
        <li>
          Have a lawful basis to upload each episode, transcript, or voice sample — including
          consent from your client and, where relevant, from guests.
        </li>
        <li>
          Do not upload content you do not have the right to process (see our{" "}
          <Link href="/legal/terms">Terms</Link>).
        </li>
        <li>
          Honour data-subject requests you receive from your clients or their audiences promptly;
          contact us if you need our help to fulfil one.
        </li>
      </ul>

      <h2 id="sharing">7. Who we share data with</h2>
      <p>
        We share personal data only with the subprocessors listed in{" "}
        <a href="#subprocessors">Section 8</a>, and only as required to run the service. We may also
        disclose data to comply with a valid legal request or to protect the rights and safety of
        Repodcast, our customers, or the public. We do not sell personal data.
      </p>

      <h2 id="subprocessors">8. Subprocessors</h2>
      <p>The current list of subprocessors we rely on:</p>
      <ul>
        <li>
          <strong>Clerk</strong> — user authentication and session management.
        </li>
        <li>
          <strong>Stripe</strong> — subscription billing and invoicing.
        </li>
        <li>
          <strong>Amazon Web Services (S3)</strong> — object storage for audio, transcripts, and
          generated content.
        </li>
        <li>
          <strong>Vercel</strong> — application hosting and edge delivery.
        </li>
        <li>
          <strong>Inngest</strong> — background job orchestration.
        </li>
        <li>
          <strong>Deepgram</strong> — audio transcription.
        </li>
        <li>
          <strong>Anthropic</strong> — large-language-model generation.
        </li>
        <li>
          <strong>PostHog</strong> — product analytics (IP anonymised).
        </li>
        <li>
          <strong>Resend</strong> — transactional email delivery.
        </li>
      </ul>
      <p>
        See our <Link href="/legal/security">Security page</Link> for how we vet and monitor these
        providers. We notify workspace admins by email before adding a new subprocessor that
        materially changes the data-handling picture.
      </p>

      <h2 id="retention">9. How long we keep data</h2>
      <ul>
        <li>
          <strong>Account and workspace data</strong> — for as long as the workspace is active, then
          90 days after cancellation to allow reactivation.
        </li>
        <li>
          <strong>Uploaded audio and transcripts</strong> — until you delete the episode, then
          purged from primary storage within 30 days and from backups within a further 60 days.
        </li>
        <li>
          <strong>Generated outputs</strong> — retained with the episode; same 30-/90-day purge
          window on deletion.
        </li>
        <li>
          <strong>Billing records</strong> — retained for the period required by tax and accounting
          law (typically 7 years).
        </li>
        <li>
          <strong>Diagnostic logs</strong> — 30 days by default; security-relevant logs up to 365
          days.
        </li>
      </ul>

      <h2 id="rights">10. Your rights</h2>
      <p>
        Depending on where you live you have rights to access, correct, export, or delete personal
        data we hold about you, to object to certain uses, and to withdraw consent. To exercise a
        right, email <a href={`mailto:${CONTACT_EMAILS.privacy}`}>{CONTACT_EMAILS.privacy}</a> from
        the address on file and we will respond within 30 days. If you believe we have not resolved
        a concern adequately you may complain to your local data-protection authority.
      </p>

      <h2 id="transfers">11. International transfers</h2>
      <p>
        Repodcast is operated from Canada. Some of our subprocessors are based in the United States
        or the European Union. Where personal data crosses borders we rely on the Standard
        Contractual Clauses or an adequate transfer mechanism recognised by the exporting
        jurisdiction.
      </p>

      <h2 id="children">12. Children</h2>
      <p>
        Repodcast is a business tool not directed at children under 16 and we do not knowingly
        collect data from them. If you believe a child has provided us data, email{" "}
        <a href={`mailto:${CONTACT_EMAILS.privacy}`}>{CONTACT_EMAILS.privacy}</a> and we will delete
        it.
      </p>

      <h2 id="changes">13. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. When we do we&rsquo;ll update the &ldquo;Last
        updated&rdquo; date at the top and, if the changes are material, notify workspace admins by
        email at least 14 days before they take effect.
      </p>

      <h2 id="contact">14. Contact</h2>
      <p>
        Repodcast &mdash; <a href={`mailto:${CONTACT_EMAILS.privacy}`}>{CONTACT_EMAILS.privacy}</a>.
        For abuse or content complaints use the <Link href="/legal/report">report form</Link>{" "}
        instead.
      </p>
    </LegalPageLayout>
  );
}
