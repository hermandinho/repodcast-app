import type { ZodType } from "zod";
import { BLOG_INDEX_OG_IMAGE_KEY, blogIndexOgImageSchema } from "./blog-index-og";
import { LANDING_SOCIAL_LINKS_KEY, landingSocialLinksSchema } from "./landing-social-links";
import {
  DEFAULT_TRUSTED_BY,
  LANDING_TRUSTED_BY_KEY,
  landingTrustedBySchema,
} from "./landing-trusted-by";

/**
 * Registry of every `SystemConfig` key the codebase reads at runtime. Powers
 * the "Known configs" panel at `/root/config` so a fresh deployment surfaces
 * a checklist of keys the app expects — instead of silently falling back to
 * built-in defaults while operators wonder why the copy on the landing looks
 * off.
 *
 * Adding a new key: create the const in the same module that reads it (see
 * `lib/landing-trusted-by.ts`), then append one entry here.
 *
 * Fields:
 * - `key`         — matches `SystemConfig.key` (UPPER_SNAKE_CASE, 2-64 chars).
 * - `label`       — short human name for the panel header.
 * - `purpose`     — one-sentence description of what the value drives.
 * - `readAt`      — where in the code the key is consumed (file path). Helps
 *                   an operator confirm they've configured the right thing.
 * - `defaultBehavior` — what the app does when the key is missing. Rendered
 *                   verbatim in the panel so the operator can decide whether
 *                   the fallback is acceptable for their deployment.
 * - `example`     — the value stored under this key when the operator picks
 *                   "Configure with defaults". Must satisfy the reader's Zod
 *                   schema.
 * - `docHref?`    — optional deep-link (e.g. relative anchor into a docs
 *                   page) shown next to the panel entry.
 */
export type KnownConfigEntry = {
  key: string;
  label: string;
  purpose: string;
  readAt: string;
  defaultBehavior: string;
  example: unknown;
  docHref?: string;
  /**
   * Route paths that render this value and must be revalidated when the key
   * is written or deleted. Without this the DB row updates but the CDN keeps
   * serving stale HTML for the affected page(s).
   */
  revalidatePaths?: readonly string[];
  /**
   * Runtime schema used by the reader. When present, `/root/config` parses
   * the stored `SystemConfig.value` against it and surfaces mismatches
   * inline — so an operator whose value fails validation sees the exact
   * reason instead of a silently-empty landing surface.
   *
   * Typed loose (`ZodType`) so we don't need per-entry generics on the
   * catalog. Callers only ever run `.safeParse` on the returned schema.
   */
  schema?: ZodType;
};

export const KNOWN_SYSTEM_CONFIG: readonly KnownConfigEntry[] = [
  {
    key: LANDING_TRUSTED_BY_KEY,
    label: "Landing “Trusted by” strip",
    purpose:
      "Studios listed under the hero on the marketing landing page. Operators edit this without a redeploy.",
    readAt: "lib/landing-trusted-by.ts",
    defaultBehavior:
      "Strip is hidden when the key is unset. Configure it to publish a studio list — placeholder names never leak to real visitors.",
    example: DEFAULT_TRUSTED_BY,
    revalidatePaths: ["/"],
    schema: landingTrustedBySchema,
  },
  {
    key: LANDING_SOCIAL_LINKS_KEY,
    label: "Landing footer social links",
    purpose:
      "Social profile URLs rendered as icons in the landing-page footer. Platform slug is a fixed enum (twitter, linkedin, youtube, instagram, github, tiktok, facebook, threads).",
    readAt: "lib/landing-social-links.ts",
    defaultBehavior:
      "Footer social row is hidden when the key is unset. Set it once with the profile URLs you want visitors to hit.",
    // Non-empty example so "Configure with defaults" seeds a usable
    // scaffold instead of an empty array. Operators are expected to swap
    // in their real profile URLs — the placeholders below are Repodcast's
    // canonical brand handles.
    example: {
      links: [
        { platform: "twitter", href: "https://twitter.com/repodcastapp" },
        { platform: "linkedin", href: "https://www.linkedin.com/company/repodcast" },
        { platform: "youtube", href: "https://youtube.com/@repodcast" },
      ],
    },
    revalidatePaths: ["/"],
    schema: landingSocialLinksSchema,
  },
  {
    key: BLOG_INDEX_OG_IMAGE_KEY,
    label: "Blog index social share image",
    purpose:
      "OpenGraph / Twitter card image rendered when /blog is shared. Managed from /root/blog (upload widget) rather than /root/config, but stored here so the audit trail + revalidation live alongside the other landing keys.",
    readAt: "lib/blog-index-og.ts",
    defaultBehavior:
      "Share card falls back to no image when the key is unset — a card without an image renders fine on Twitter and LinkedIn; a broken URL does not.",
    example: {
      url: "https://pub-xxxxxxxx.r2.dev/blog/index-og.png",
    },
    revalidatePaths: ["/blog"],
    schema: blogIndexOgImageSchema,
  },
];

/** Look up a catalog entry by its `SystemConfig.key`. */
export function findKnownConfig(key: string): KnownConfigEntry | undefined {
  return KNOWN_SYSTEM_CONFIG.find((entry) => entry.key === key);
}

/**
 * One human-readable message per schema issue. Empty array = value parses
 * cleanly. Uses `error.issues` (rather than `flatten()`) so callers can show
 * "links[0].platform: Invalid input" instead of a generic per-field bag.
 */
export type ConfigValidationIssue = { path: string; message: string };

export function validateConfigValue(
  entry: KnownConfigEntry,
  value: unknown,
): ConfigValidationIssue[] {
  if (!entry.schema) return [];
  const parsed = entry.schema.safeParse(value);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
    message: issue.message,
  }));
}

/**
 * Merge the catalog with the persisted SystemConfig rows so the UI can show
 * per-key status without cross-referencing on the render side. The catalog
 * order is preserved; unknown DB keys (ad-hoc entries added by an operator)
 * are omitted — the "Platform config" section below already lists those.
 *
 * `issues` is populated when the entry has a `schema` AND the stored value
 * fails to parse. Empty array otherwise (not-yet-configured OR configured
 * and valid OR no schema defined).
 */
export function mergeKnownConfigStatus(
  configured: readonly { key: string; value: unknown }[],
): Array<KnownConfigEntry & { isConfigured: boolean; issues: ConfigValidationIssue[] }> {
  const rowByKey = new Map(configured.map((r) => [r.key, r.value]));
  return KNOWN_SYSTEM_CONFIG.map((entry) => {
    const value = rowByKey.get(entry.key);
    const isConfigured = rowByKey.has(entry.key);
    const issues = isConfigured ? validateConfigValue(entry, value) : [];
    return { ...entry, isConfigured, issues };
  });
}

export function countMissingKnownConfigs(configured: readonly { key: string }[]): number {
  const configuredKeys = new Set(configured.map((r) => r.key));
  return KNOWN_SYSTEM_CONFIG.reduce((n, entry) => (configuredKeys.has(entry.key) ? n : n + 1), 0);
}
