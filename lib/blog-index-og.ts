import "server-only";

import { z } from "zod";
import { isLiveDb } from "@/server/data/source";
import { getSystemConfigValue } from "@/server/db/system/config";

/**
 * OpenGraph / Twitter card image for `/blog`. Managed from `/root/blog`
 * under the `BLOG_INDEX_OG_IMAGE_URL` SystemConfig key so an operator can
 * refresh the share card without a redeploy. The shape is deliberately a
 * single URL — per-post cards live on the row itself (`coverImageUrl`), so
 * we don't need a nested object here.
 *
 * Sample-data mode + DB errors + missing key + bad JSON all fall through to
 * `null`, which the metadata generator interprets as "omit the images
 * field" — a card without an image is preferable to serving a broken one.
 */

export const BLOG_INDEX_OG_IMAGE_KEY = "BLOG_INDEX_OG_IMAGE_URL";

export const blogIndexOgImageSchema = z.object({
  url: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((v) => /^https?:\/\//.test(v), "Must be an absolute http(s) URL"),
});
export type BlogIndexOgImage = z.infer<typeof blogIndexOgImageSchema>;

export async function getBlogIndexOgImageUrl(): Promise<string | null> {
  if (!isLiveDb()) return null;

  let raw: unknown;
  try {
    raw = await getSystemConfigValue(BLOG_INDEX_OG_IMAGE_KEY);
  } catch {
    return null;
  }
  if (raw == null) return null;

  const parsed = blogIndexOgImageSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(
      `[blog-index-og] ${BLOG_INDEX_OG_IMAGE_KEY} failed schema — falling back to no image`,
      parsed.error.flatten(),
    );
    return null;
  }
  return parsed.data.url;
}
