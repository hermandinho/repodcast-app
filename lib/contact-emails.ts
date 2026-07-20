/**
 * Public contact addresses shown on marketing + legal surfaces.
 *
 * Sourced from env so mailboxes can be re-aliased without a code change.
 * Values are rendered by server components straight into HTML, so no
 * `NEXT_PUBLIC_` prefix is needed. Missing vars fall back to the
 * `@repodcastapp.com` defaults — pages still render and links still work,
 * and the fallback keeps this file usable from local dev without an
 * `.env.local`.
 */

export const CONTACT_EMAILS = {
  hello: process.env.CONTACT_EMAIL_HELLO ?? "hello@repodcastapp.com",
  support: process.env.CONTACT_EMAIL_SUPPORT ?? "support@repodcastapp.com",
  privacy: process.env.CONTACT_EMAIL_PRIVACY ?? "privacy@repodcastapp.com",
  security: process.env.CONTACT_EMAIL_SECURITY ?? "security@repodcastapp.com",
  legal: process.env.CONTACT_EMAIL_LEGAL ?? "legal@repodcastapp.com",
  /**
   * Inbox that receives in-app Feedback submissions (Bug / Feature request
   * / etc.) from the tenant dashboard's Feedback button. Also surfaced on
   * `/root/feedback` for triage — email is a best-effort mirror.
   */
  feedback: process.env.CONTACT_EMAIL_SUPPORT ?? "support@repodcastapp.com",
} as const;

export type ContactEmailKey = keyof typeof CONTACT_EMAILS;
