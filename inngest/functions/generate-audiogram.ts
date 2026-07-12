import { NonRetriableError } from "inngest";
import { prisma } from "@/server/db/client";
import { captureInngestFailure } from "@/server/observability/sentry";
import type { Events } from "../events";
import { inngest } from "../client";

/**
 * Q1 wk10 — audiogram (waveform video) renderer for a single output.
 *
 * WK1 STUB: verifies event plumbing and tenant scoping only. The full
 * pipeline is:
 *   1. Load GeneratedOutput + episode + agency; assert `agencyId` matches.
 *   2. Slice the episode transcript SRT to the output's referenced range
 *      (or the whole episode if the output doesn't declare one).
 *   3. Sign an R2 GET URL for the source audio.
 *   4. Call `renderAudiogram()` on the VPS worker.
 *   5. Attach the resulting MP4 to the output's Buffer post (or expose
 *      it as a download for platforms Buffer doesn't cover).
 */

export const generateAudiogram = inngest.createFunction(
  {
    id: "generate-audiogram",
    triggers: [{ event: "output/audiogram.requested" }],
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
      const { outputId } = event.data.event.data as Events["output/audiogram.requested"]["data"];
      captureInngestFailure("generate_audiogram", error, { outputId });
    },
  },
  async ({ event, step, logger }) => {
    const { outputId, agencyId } = event.data;

    const output = await step.run("load-output", async () => {
      const row = await prisma.generatedOutput.findUnique({
        where: { id: outputId },
        select: {
          id: true,
          platform: true,
          episode: {
            select: {
              audioUrl: true,
              show: { select: { client: { select: { agencyId: true } } } },
            },
          },
        },
      });
      if (!row) throw new NonRetriableError(`Output ${outputId} not found`);
      if (row.episode.show.client.agencyId !== agencyId) {
        throw new NonRetriableError(`Output ${outputId} does not belong to agency ${agencyId}`);
      }
      return row;
    });

    logger.info(
      { outputId, agencyId, platform: output.platform },
      "generate-audiogram: stub — ffmpeg showwaves pipeline lands in wk10",
    );

    // TODO(Q1-wk10): implement renderAudiogram() call + result persistence.
    // See Q1.md §Feature #5.
    return { outputId, note: "stub" };
  },
);
