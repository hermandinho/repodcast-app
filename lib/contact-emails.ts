/**
 * Public contact addresses shown on marketing + legal surfaces.
 *
 * Sourced from env so mailboxes can be re-aliased without a code change.
 * Values are rendered by server components straight into HTML, so no
 * `NEXT_PUBLIC_` prefix is needed. Missing vars fall back to the
 * `@repodcast.io` defaults used elsewhere in the codebase — pages still
 * render and links still work, and the fallback keeps this file usable
 * from local dev without an `.env.local`.
 */

export const CONTACT_EMAILS = {
  hello: process.env.CONTACT_EMAIL_HELLO ?? "hello@repodcast.io",
  support: process.env.CONTACT_EMAIL_SUPPORT ?? "support@repodcast.io",
  privacy: process.env.CONTACT_EMAIL_PRIVACY ?? "privacy@repodcast.io",
  security: process.env.CONTACT_EMAIL_SECURITY ?? "security@repodcast.io",
  legal: process.env.CONTACT_EMAIL_LEGAL ?? "legal@repodcast.io",
} as const;

export type ContactEmailKey = keyof typeof CONTACT_EMAILS;
