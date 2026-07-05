import "server-only";

import { z } from "zod";
import { isLiveDb } from "@/server/data/source";
import { getSystemConfigValue } from "@/server/db/system/config";

/**
 * Landing "Trusted by growing studios" strip. Managed from `/root/config`
 * under the `LANDING_TRUSTED_BY` key so a system admin can update the
 * heading + studio list without a redeploy. The shape is intentionally
 * flat — a name and an optional link per row — since anything richer
 * (logo images, testimonials) is a schema-migration conversation.
 *
 * When the key is missing OR the stored JSON fails schema validation OR
 * the DB read errors, the landing falls back to `DEFAULT_TRUSTED_BY`,
 * which has an empty studios list — the landing hides the strip entirely
 * in that case. That's deliberate: showing placeholder studio names on a
 * real marketing page would misrepresent the customer base.
 */

export const LANDING_TRUSTED_BY_KEY = "LANDING_TRUSTED_BY";

const trustedByStudioSchema = z.object({
  name: z.string().trim().min(1).max(80),
  href: z.string().trim().url().max(500).optional(),
});

export const landingTrustedBySchema = z.object({
  heading: z.string().trim().min(1).max(120).optional(),
  studios: z.array(trustedByStudioSchema).max(24),
});

export type LandingTrustedBy = z.infer<typeof landingTrustedBySchema>;

export const DEFAULT_TRUSTED_BY: Required<Pick<LandingTrustedBy, "heading">> & LandingTrustedBy = {
  heading: "Trusted by growing studios",
  // Empty by design — see the file header. LandingPage's Hero conditionally
  // hides the strip when `studios.length === 0`.
  studios: [],
};

/**
 * Reads the strip config, validates it, and returns a fully-populated
 * object (heading always set) so the landing view can render without
 * defensive checks. Sample-data mode + DB blips fall through to the
 * default list.
 */
export async function getLandingTrustedBy(): Promise<
  Required<Pick<LandingTrustedBy, "heading">> & LandingTrustedBy
> {
  if (!isLiveDb()) return DEFAULT_TRUSTED_BY;

  let raw: unknown;
  try {
    raw = await getSystemConfigValue(LANDING_TRUSTED_BY_KEY);
  } catch {
    return DEFAULT_TRUSTED_BY;
  }
  if (raw == null) return DEFAULT_TRUSTED_BY;

  const parsed = landingTrustedBySchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(
      `[landing-trusted-by] ${LANDING_TRUSTED_BY_KEY} failed schema — falling back to defaults`,
      parsed.error.flatten(),
    );
    return DEFAULT_TRUSTED_BY;
  }

  return {
    heading: parsed.data.heading ?? DEFAULT_TRUSTED_BY.heading,
    studios: parsed.data.studios,
  };
}
