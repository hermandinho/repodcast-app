import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { LegalPageLayout } from "@/components/legal/legal-page-layout";
import { CONTACT_EMAILS } from "@/lib/contact-emails";

/**
 * First-draft Terms of Service. Written to reflect the product surface
 * that exists today (agency workspaces, per-client voice models,
 * subscription billing, abuse-report intake). Language is plain-English
 * first-draft — counsel review required before public launch.
 */

const LAST_UPDATED = "July 2, 2026";

export const metadata: Metadata = {
  title: "Terms — Repodcast",
  description:
    "The rules that govern your use of Repodcast — acceptable use, billing, content ownership, warranties, and how the agreement ends.",
};

export default async function TermsPage() {
  const { userId } = await auth();

  return (
    <LegalPageLayout
      isSignedIn={!!userId}
      eyebrow="Legal"
      title="Terms of Service"
      intro="These Terms are the agreement between Repodcast and the agency operating a Repodcast workspace. Creating a workspace or using the service means you accept them."
      lastUpdated={LAST_UPDATED}
    >
      <h2 id="parties">1. The parties</h2>
      <p>
        &ldquo;<strong>Repodcast</strong>,&rdquo; &ldquo;<strong>we</strong>,&rdquo; and &ldquo;
        <strong>us</strong>&rdquo; refer to the company operating repodcast.io. &ldquo;
        <strong>You</strong>&rdquo; refers to the agency that has created a Repodcast workspace and
        each individual you invite into it. Your clients (the podcasters or brands you serve) are
        not parties to these Terms; the relationship between you and your clients is governed by
        your own agreements with them.
      </p>

      <h2 id="the-service">2. The service</h2>
      <p>
        Repodcast is a platform for podcast agencies to turn episodes into platform-ready content in
        a client&rsquo;s voice. Features include audio ingestion, transcription, voice-style
        profiles, content generation, approval workflows, scheduling, billing, and analytics. We
        add, change, and retire features over time; where a change would materially reduce a feature
        you rely on, we&rsquo;ll give reasonable notice.
      </p>

      <h2 id="accounts">3. Accounts and roles</h2>
      <ul>
        <li>
          One workspace represents one agency. Every seat inside the workspace is a real named
          person; do not share credentials.
        </li>
        <li>
          Workspace admins can invite, remove, and re-role other seats and are responsible for those
          decisions.
        </li>
        <li>
          You are responsible for keeping your login credentials confidential and for all activity
          under your account. Notify us at{" "}
          <a href={`mailto:${CONTACT_EMAILS.security}`}>{CONTACT_EMAILS.security}</a> immediately if
          you suspect unauthorised access.
        </li>
      </ul>

      <h2 id="acceptable-use">4. Acceptable use</h2>
      <p>You agree not to, and not to let anyone else:</p>
      <ul>
        <li>
          Upload content you do not have the right to process — including audio, transcripts, or
          voice samples where the speaker has not consented to your use of them here.
        </li>
        <li>
          Impersonate a person or brand, or generate content designed to mislead audiences about who
          is speaking.
        </li>
        <li>
          Generate or distribute content that is unlawful, defamatory, harassing, hateful, or
          sexually explicit involving real people without consent.
        </li>
        <li>
          Reverse-engineer, scrape, or attempt to extract source code, models, prompts, or
          embeddings from the service, other than as expressly permitted by applicable law.
        </li>
        <li>
          Use the service to build a directly competing product, or to train a competing generative
          model on outputs produced here.
        </li>
        <li>
          Overwhelm the service — no denial-of-service, credential stuffing, or abusive automated
          traffic.
        </li>
      </ul>
      <p>
        We may suspend or terminate a workspace that violates these rules. Content complaints and
        abuse reports go through the <Link href="/legal/report">report form</Link>.
      </p>

      <h2 id="content-ownership">5. Content ownership and licences</h2>

      <h3>5.1 Your content</h3>
      <p>
        You retain all rights to the audio, transcripts, notes, and other material you or your
        clients upload (&ldquo;<strong>Customer Content</strong>&rdquo;). You grant Repodcast a
        worldwide, non-exclusive, royalty-free licence to host, process, and display Customer
        Content solely as needed to operate the service for you (including transcription, voice
        profiling, generation, and delivery to platforms you connect).
      </p>

      <h3>5.2 Generated outputs</h3>
      <p>
        Content the service generates from your inputs (&ldquo;<strong>Outputs</strong>&rdquo;) is
        yours to use, edit, publish, and monetise. Because generative models can produce similar
        outputs from similar inputs, we do not warrant that Outputs are unique to you.
      </p>

      <h3>5.3 Feedback</h3>
      <p>
        If you send us ideas or suggestions, you grant us a perpetual, irrevocable, royalty-free
        licence to use them without obligation to you.
      </p>

      <h3>5.4 Our IP</h3>
      <p>
        The Repodcast software, brand, UI, documentation, and any voice-quality benchmarks or
        prompts we author remain our intellectual property. Nothing in these Terms transfers that to
        you.
      </p>

      <h2 id="fees">6. Fees and billing</h2>
      <ul>
        <li>
          Paid plans are billed monthly or annually as chosen in your workspace. Fees are non-
          refundable except where required by law or where we terminate the service for reasons
          other than your breach.
        </li>
        <li>
          If a payment fails we will retry over a short grace window; sustained non-payment leads to
          suspension and eventual termination of the workspace.
        </li>
        <li>
          We may change list prices with at least 30 days&rsquo; notice. Price changes take effect
          on your next renewal.
        </li>
        <li>
          Taxes and duties are your responsibility unless we are required by law to collect them.
        </li>
      </ul>

      <h2 id="clients">7. Your clients and their audiences</h2>
      <p>
        You are the controller of your clients&rsquo; data inside Repodcast; we are the processor
        acting on your instructions. You are responsible for the terms you have with your clients,
        for informing them of Repodcast&rsquo;s involvement where required, and for responding to
        their access, correction, and deletion requests. Contact{" "}
        <a href={`mailto:${CONTACT_EMAILS.privacy}`}>{CONTACT_EMAILS.privacy}</a> if you need our
        help to fulfil one.
      </p>

      <h2 id="third-party-integrations">8. Third-party integrations</h2>
      <p>
        Repodcast lets you connect third-party services (for example, hosting providers, social
        platforms, and scheduling tools). Your use of those services is governed by their own terms.
        We are not responsible for their availability, decisions, or the content they publish on
        your behalf beyond what our integration was asked to do.
      </p>

      <h2 id="beta">9. Beta features</h2>
      <p>
        We sometimes release features marked as beta, preview, or experimental. Those features are
        provided as-is, may change or disappear without notice, and are not covered by any service
        commitment.
      </p>

      <h2 id="warranties">10. Warranties and disclaimers</h2>
      <p>
        We provide the service with reasonable skill and care. To the fullest extent permitted by
        law, we disclaim all other warranties, express or implied, including merchantability,
        fitness for a particular purpose, and non-infringement. We do not warrant that the service
        will be uninterrupted, error-free, or that generated content will be accurate, unique, or
        suitable for a specific audience &mdash; you remain responsible for reviewing outputs before
        publication.
      </p>

      <h2 id="liability">11. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, neither party is liable for indirect, incidental,
        special, consequential, or exemplary damages, or for lost profits, revenue, or data. Our
        total aggregate liability arising out of or relating to these Terms will not exceed the fees
        you paid to Repodcast in the 12 months preceding the event giving rise to the claim.
      </p>

      <h2 id="indemnity">12. Indemnity</h2>
      <p>
        You will defend and indemnify Repodcast from third-party claims arising out of Customer
        Content, your breach of these Terms, or your violation of law. We will defend and indemnify
        you from third-party claims that the service, used as permitted here, infringes their
        intellectual-property rights &mdash; excluding claims caused by Customer Content, your
        modifications, or your combination of the service with other products.
      </p>

      <h2 id="term-termination">13. Term and termination</h2>
      <ul>
        <li>These Terms remain in effect while your workspace is active.</li>
        <li>
          You may cancel at any time from your workspace billing settings. Access continues to the
          end of the paid period.
        </li>
        <li>
          We may suspend or terminate the service if you materially breach these Terms and fail to
          cure within 15 days of notice, or immediately for repeated or egregious violations
          (including <Link href="#acceptable-use">Section 4</Link> breaches).
        </li>
        <li>
          On termination we will delete Customer Content according to the retention schedule in our{" "}
          <Link href="/legal/privacy#retention">Privacy Policy</Link>. Export tools are available
          before the workspace closes.
        </li>
      </ul>

      <h2 id="modifications">14. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. When we do we&rsquo;ll update the &ldquo;Last
        updated&rdquo; date at the top and, if the changes are material, notify workspace admins by
        email at least 14 days before they take effect. Continued use of the service after that date
        is acceptance of the updated Terms.
      </p>

      <h2 id="governing-law">15. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of the Province of Ontario, Canada, without regard to
        conflict-of-laws principles. The parties submit to the exclusive jurisdiction of the courts
        located in Toronto, Ontario for any dispute not resolved informally first. Nothing here
        prevents either party from seeking injunctive relief in an appropriate court.
      </p>

      <h2 id="misc">16. Miscellaneous</h2>
      <ul>
        <li>
          <strong>Entire agreement</strong> — these Terms plus any order form and the linked
          policies (Privacy, Security) are the entire agreement between us on this subject.
        </li>
        <li>
          <strong>Assignment</strong> — you may not assign these Terms without our written consent;
          we may assign them in connection with a merger, acquisition, or sale of assets.
        </li>
        <li>
          <strong>No waiver</strong> — failure to enforce a right does not waive it.
        </li>
        <li>
          <strong>Severability</strong> — if a provision is held unenforceable, the rest remains in
          force.
        </li>
        <li>
          <strong>Notices</strong> — email to{" "}
          <a href={`mailto:${CONTACT_EMAILS.legal}`}>{CONTACT_EMAILS.legal}</a> for us; to the
          workspace admin&rsquo;s email on file for you.
        </li>
      </ul>

      <h2 id="contact">17. Contact</h2>
      <p>
        Questions about these Terms? Email{" "}
        <a href={`mailto:${CONTACT_EMAILS.legal}`}>{CONTACT_EMAILS.legal}</a>.
      </p>
    </LegalPageLayout>
  );
}
