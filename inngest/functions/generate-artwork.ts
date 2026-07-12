import { NonRetriableError } from "inngest";
import { prisma } from "@/server/db/client";
import { captureInngestFailure } from "@/server/observability/sentry";
import type { Events } from "../events";
import { inngest } from "../client";

/**
 * Q1 wk4 — episode hero artwork (square / 16:9 / 9:16) via Cloudflare
 * Workers AI. Does NOT touch the VPS worker — Workers AI is called
 * directly from Inngest.
 *
 * WK1 STUB: verifies event plumbing and tenant scoping only. The full
 * pipeline is:
 *   1. Load Episode + transcript + key moments + show voice description.
 *   2. Ask Claude for a visual concept ({ subject, mood, palette }).
 *   3. Call CF Workers AI (`@cf/black-forest-labs/flux-1-schnell`) with
 *      three separate prompts — one per aspect ratio.
 *   4. Upload PNG bytes to R2 under artwork/{agencyId}/{episodeId}/.
 *   5. Patch Episode.heroImageUrl / squareCoverUrl / verticalCoverUrl.
 */

export const generateArtwork = inngest.createFunction(
  {
    id: "generate-artwork",
    triggers: [{ event: "episode/artwork.requested" }],
    retries: 2,
    // Workers AI free tier: 10k neurons/day. Cap concurrency modestly to
    // avoid burning the daily budget on one agency's backfill.
    concurrency: [{ limit: 6 }, { scope: "fn", key: "event.data.agencyId", limit: 3 }],
    onFailure: async ({ event, error }) => {
      const { episodeId } = event.data.event.data as Events["episode/artwork.requested"]["data"];
      captureInngestFailure("generate_artwork", error, { episodeId });
    },
  },
  async ({ event, step, logger }) => {
    const { episodeId, agencyId } = event.data;

    const episode = await step.run("load-episode", async () => {
      const row = await prisma.episode.findUnique({
        where: { id: episodeId },
        select: {
          id: true,
          show: { select: { client: { select: { agencyId: true } } } },
        },
      });
      if (!row) throw new NonRetriableError(`Episode ${episodeId} not found`);
      if (row.show.client.agencyId !== agencyId) {
        throw new NonRetriableError(`Episode ${episodeId} does not belong to agency ${agencyId}`);
      }
      return row;
    });

    logger.info(
      { episodeId, agencyId },
      "generate-artwork: stub — Workers AI (flux-1-schnell) pipeline lands in wk4",
    );

    // TODO(Q1-wk4): implement two-stage prompt (Claude → image model) +
    // R2 upload + Episode field updates. See Q1.md §Feature #4.
    void episode;
    return { episodeId, note: "stub" };
  },
);
