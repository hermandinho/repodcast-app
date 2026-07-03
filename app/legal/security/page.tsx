import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { LegalPageLayout } from "@/components/legal/legal-page-layout";
import { CONTACT_EMAILS } from "@/lib/contact-emails";

/**
 * First-draft Security page. Describes the controls that are actually in
 * place today (Clerk auth + optional MFA, encryption in transit, S3
 * server-side encryption, tenant isolation at the workspace layer,
 * least-privilege operator access to the internal admin surface) rather
 * than aspirational claims. Update as controls evolve; do not add
 * certifications we do not hold. Do not name the internal admin path
 * or role identifiers on this page — those stay off the public surface.
 */

const LAST_UPDATED = "July 2, 2026";

export const metadata: Metadata = {
  title: "Security — Repodcast",
  description:
    "How Repodcast protects your audio, transcripts, voice profiles, and generated content — from infrastructure to operator access to incident response.",
};

export default async function SecurityPage() {
  const { userId } = await auth();

  return (
    <LegalPageLayout
      isSignedIn={!!userId}
      eyebrow="Legal"
      title="Security"
      intro={`A plain-English summary of the security controls we run today. If you need something we haven't listed — a data-processing addendum, a vendor questionnaire, a scoped-down retention — email ${CONTACT_EMAILS.security} and we'll answer.`}
      lastUpdated={LAST_UPDATED}
    >
      <h2 id="principles">1. Our principles</h2>
      <ul>
        <li>
          <strong>Least privilege</strong> — every seat, service, and operator gets the smallest set
          of permissions needed to do the job.
        </li>
        <li>
          <strong>Tenant isolation</strong> — an agency&rsquo;s workspace, its clients, and their
          voice profiles are scoped so one agency cannot reach another&rsquo;s data.
        </li>
        <li>
          <strong>Defence in depth</strong> — auth, network, storage, and application controls
          overlap so a single failure isn&rsquo;t catastrophic.
        </li>
        <li>
          <strong>Honesty over theatre</strong> — this page describes controls we actually run, not
          controls we aspire to. Certifications we don&rsquo;t hold are not listed.
        </li>
      </ul>

      <h2 id="authentication">2. Authentication and access</h2>
      <ul>
        <li>
          User authentication is handled by <strong>Clerk</strong>. Passwords are never stored by
          Repodcast; Clerk uses bcrypt with a per-user salt.
        </li>
        <li>
          <strong>Multi-factor authentication</strong> is available to every workspace and is
          enforced by policy for internal staff with elevated access.
        </li>
        <li>
          Session tokens are short-lived, HTTP-only, and scoped to the workspace. Sessions can be
          revoked from Clerk&rsquo;s security panel or by a workspace admin.
        </li>
        <li>
          Sign-up and sign-in traffic is rate-limited and monitored for credential-stuffing
          patterns.
        </li>
      </ul>

      <h2 id="encryption">3. Encryption</h2>
      <ul>
        <li>
          <strong>In transit</strong> — all traffic to repodcastapp.com is served over TLS 1.2 or
          higher with modern cipher suites. HSTS is enabled.
        </li>
        <li>
          <strong>At rest</strong> — audio, transcripts, and generated content live in Amazon S3
          with server-side encryption (AES-256, SSE-S3). Database storage uses the managed
          provider&rsquo;s at-rest encryption.
        </li>
        <li>
          <strong>Secrets</strong> — API keys and credentials for subprocessors are stored in the
          hosting provider&rsquo;s encrypted environment store and are never checked into source
          control.
        </li>
      </ul>

      <h2 id="tenant-isolation">4. Tenant isolation</h2>
      <p>
        Every database query and every S3 object read is scoped to the requesting workspace at the
        application layer. Server actions and route handlers derive the acting agency from the
        signed session and refuse cross-agency access. Portal tokens used by your clients are
        single-use, expiring, and scoped to a single client within your workspace.
      </p>

      <h2 id="operator-access">5. Operator access</h2>
      <p>
        A very small number of Repodcast staff hold an operator role used for support, quality
        triage, and abuse response. That role is granted separately from the tenant workspaces you
        use day-to-day. Operator access:
      </p>
      <ul>
        <li>Requires an explicit operator grant plus multi-factor authentication.</li>
        <li>
          Cannot silently take over a workspace session — impersonation, when used for support, is
          signed and produces an audit-trail entry visible to Repodcast on review.
        </li>
        <li>
          Is logged. High-sensitivity actions (data export, workspace impersonation, forced
          deletion) produce an audit-trail entry retained for review.
        </li>
      </ul>

      <h2 id="infrastructure">6. Infrastructure</h2>
      <ul>
        <li>
          <strong>Hosting</strong> — the application runs on Vercel&rsquo;s managed platform in
          North America and Europe regions.
        </li>
        <li>
          <strong>Object storage</strong> — audio, transcripts, and generated content live in Amazon
          S3 with versioning and lifecycle policies.
        </li>
        <li>
          <strong>Background work</strong> — Inngest orchestrates transcription, generation, and
          scheduled delivery. Job payloads are signed and replay-protected.
        </li>
        <li>
          <strong>Uptime monitoring</strong> — health probes and error-rate alerts page the on-call
          engineer.
        </li>
      </ul>

      <h2 id="ai-providers">7. AI providers</h2>
      <p>
        Content is transcribed by <strong>Deepgram</strong> and generated by{" "}
        <strong>Anthropic</strong>. Both are contracted so that your content is used <em>only</em>{" "}
        to return the requested output — not to train their public foundation models. We restrict
        what we send: prompts include the minimum context a request needs, and we do not send
        billing, PII, or session tokens to model providers.
      </p>

      <h2 id="subprocessors">8. Subprocessors and vendor review</h2>
      <p>
        Every subprocessor we use is listed in the{" "}
        <Link href="/legal/privacy#subprocessors">Privacy Policy</Link>. Before we adopt a new one
        we review their security posture, data-processing terms, and residency options. Workspace
        admins are notified by email before we add a subprocessor that materially changes the
        data-handling picture.
      </p>

      <h2 id="sdlc">9. Development practices</h2>
      <ul>
        <li>
          Code changes flow through pull requests with automated linting, type-checking, and unit +
          integration tests before merge.
        </li>
        <li>
          Dependencies are pinned; known-vulnerable versions are flagged by automated scanning and
          triaged.
        </li>
        <li>
          Feature flags gate risky launches; new abuse-adjacent surfaces are opt-in and monitored.
        </li>
        <li>
          Production access is broker-mediated; no engineer has standing access to production
          databases without a paged incident.
        </li>
      </ul>

      <h2 id="backups">10. Backups and continuity</h2>
      <ul>
        <li>Managed database is backed up daily; point-in-time recovery is available.</li>
        <li>
          S3 objects have versioning enabled. Deletes are soft for 30 days before the object is
          removed from primary storage.
        </li>
        <li>Restoration procedures are exercised periodically.</li>
      </ul>

      <h2 id="incident-response">11. Incident response</h2>
      <p>
        We investigate every security signal. If we confirm a data incident that affects your
        workspace, we&rsquo;ll notify the workspace admin without undue delay &mdash; and within any
        legally required timeline &mdash; with what happened, what data was involved, what
        we&rsquo;ve done, and what we recommend you do. Report a suspected issue to{" "}
        <a href={`mailto:${CONTACT_EMAILS.security}`}>{CONTACT_EMAILS.security}</a> at any time.
      </p>

      <h2 id="disclosure">12. Responsible disclosure</h2>
      <p>
        If you believe you&rsquo;ve found a vulnerability, please email{" "}
        <a href={`mailto:${CONTACT_EMAILS.security}`}>{CONTACT_EMAILS.security}</a> with
        reproduction steps and, if you&rsquo;d like, a preferred handle for the acknowledgement. We
        commit to acknowledging within two business days and to keeping you posted while we
        investigate. We will not pursue legal action against researchers who act in good faith,
        respect user privacy, and give us reasonable time to fix an issue before public disclosure.
      </p>

      <h2 id="what-we-dont-have">13. What we don&rsquo;t have yet</h2>
      <p>
        We currently do <strong>not</strong> hold SOC 2, ISO 27001, or HIPAA certifications. If your
        procurement process requires any of these, tell us early &mdash; we&rsquo;ll be
        straightforward about whether we can meet the requirement in the timeframe you have.
      </p>

      <h2 id="contact">14. Contact</h2>
      <p>
        Security questions and reports go to{" "}
        <a href={`mailto:${CONTACT_EMAILS.security}`}>{CONTACT_EMAILS.security}</a>. For content
        complaints, please use the <Link href="/legal/report">report form</Link> instead.
      </p>
    </LegalPageLayout>
  );
}
