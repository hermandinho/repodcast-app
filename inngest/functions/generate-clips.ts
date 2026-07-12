import { NonRetriableError } from "inngest";
import { prisma } from "@/server/db/client";
import { captureInngestFailure } from "@/server/observability/sentry";
import type { Events } from "../events";
import { inngest } from "../client";

/**
 * Q1 wk3 — clip generation orchestrator.
 *
 * WK1 STUB: verifies event plumbing and tenant scoping only. The full
 * pipeline is:
 *   1. Load Episode + assert `agencyId` matches (tenant guard).
 *   2. Call `server/ai/highlight-selection.ts` to pick top-N spans from
 *      the transcript.
 *   3. For each span, create a `VideoClip` row in PENDING.
 *   4. Fan out to the VPS render worker via
 *      `server/media/render-worker.ts::renderClip()`.
 *   5. On worker response, patch the VideoClip → READY with
 *      renderedUrl/posterUrl/captionsUrl, or FAILED with renderError.
 *
 * Concurrency is capped at 2 per agency because the render worker itself
 * caps in-process ffmpeg jobs at 2 (see worker/README.md).
 */

const MAX_CLIPS_DEFAULT = 5;
const MAX_CLIPS_CEILING = 10;

export const generateClips = inngest.createFunction(
  {
    id: "generate-clips",
    triggers: [{ event: "episode/clips.requested" }],
    retries: 2,
    concurrency: [
      { limit: 4 },
      {
        scope: "fn",
        key: "event.data.agencyId",
        limit: 2,
      },
    ],
    onFailure: async ({ event, error }) => {
      const { episodeId } = event.data.event.data as Events["episode/clips.requested"]["data"];
      captureInngestFailure("generate_clips", error, { episodeId });
    },
  },
  async ({ event, step, logger }) => {
    const { episodeId, agencyId, maxClips } = event.data;
    const limit = Math.min(maxClips ?? MAX_CLIPS_DEFAULT, MAX_CLIPS_CEILING);

    // Tenant guard — Episode → Show → Client → Agency must match.
    const episode = await step.run("load-episode", async () => {
      const row = await prisma.episode.findUnique({
        where: { id: episodeId },
        select: {
          id: true,
          sourceVideoUrl: true,
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
      { episodeId, agencyId, limit, hasSourceVideo: Boolean(episode.sourceVideoUrl) },
      "generate-clips: stub — highlight selection + render pipeline lands in wk3",
    );

    // TODO(Q1-wk3): implement highlight selection + VideoClip creation +
    // renderClip() fan-out. See Q1.md §Feature #1.
    return { episodeId, planned: limit, rendered: 0, note: "stub" };
  },
);
