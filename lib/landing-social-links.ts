import "server-only";

import { z } from "zod";
import { isLiveDb } from "@/server/data/source";
import { getSystemConfigValue } from "@/server/db/system/config";

/**
 * Landing footer social icons. Managed from `/root/config` under the
 * `LANDING_SOCIAL_LINKS` key so a system admin can update the profile URLs
 * without a redeploy. The shape is intentionally flat — a fixed platform
 * enum + URL per row — since anything richer (custom icons, labels) is a
 * schema-migration conversation.
 *
 * When the key is missing OR the stored JSON fails schema validation OR
 * the DB read errors, the landing falls back to `DEFAULT_SOCIAL_LINKS`,
 * which has an empty links list — the footer hides the section entirely
 * in that case (matching the "no placeholder studios" rule enforced by
 * the sibling `landing-trusted-by.ts` module).
 */

export const LANDING_SOCIAL_LINKS_KEY = "LANDING_SOCIAL_LINKS";

/**
 * Fixed set of platforms we know how to render. Keeps operators from
 * pasting arbitrary hrefs that would render as unlabeled dots. Adding a
 * new platform: append the slug here + drop the matching SVG into the
 * icon map in `components/landing/social-icon.tsx`.
 */
export const SOCIAL_PLATFORMS = [
  "twitter",
  "linkedin",
  "youtube",
  "instagram",
  "github",
  "tiktok",
  "facebook",
  "threads",
] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

const socialLinkSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  href: z.string().trim().url().max(500),
});
export type SocialLink = z.infer<typeof socialLinkSchema>;

export const landingSocialLinksSchema = z.object({
  links: z.array(socialLinkSchema).max(12),
});
export type LandingSocialLinks = z.infer<typeof landingSocialLinksSchema>;

export const DEFAULT_SOCIAL_LINKS: LandingSocialLinks = {
  // Empty by design — the footer conditionally hides the strip when
  // `links.length === 0` so a fresh deployment doesn't leak placeholder
  // profile URLs to real visitors.
  links: [],
};

/**
 * Reads the social-links config, validates it, and returns a shape the
 * landing footer can render without defensive checks. Sample-data mode +
 * DB blips fall through to the default (empty) list.
 */
export async function getLandingSocialLinks(): Promise<LandingSocialLinks> {
  if (!isLiveDb()) return DEFAULT_SOCIAL_LINKS;

  let raw: unknown;
  try {
    raw = await getSystemConfigValue(LANDING_SOCIAL_LINKS_KEY);
  } catch {
    return DEFAULT_SOCIAL_LINKS;
  }
  if (raw == null) return DEFAULT_SOCIAL_LINKS;

  const parsed = landingSocialLinksSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(
      `[landing-social-links] ${LANDING_SOCIAL_LINKS_KEY} failed schema — falling back to defaults`,
      parsed.error.flatten(),
    );
    return DEFAULT_SOCIAL_LINKS;
  }

  return parsed.data;
}
