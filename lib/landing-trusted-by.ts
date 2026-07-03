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
 * the DB read errors, the landing renders `DEFAULT_TRUSTED_BY` so the
 * hero never falls back to a broken/empty strip. Admins can set
 * `studios: []` explicitly to hide the strip entirely.
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
  studios: [
    { name: "Northwind Audio" },
    { name: "Tightrope" },
    { name: "Frequency Lab" },
    { name: "Open Mic Co." },
    { name: "Halftone" },
  ],
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
