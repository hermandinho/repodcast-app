import { NonRetriableError } from "inngest";
import { CLAUDE_MODEL, requireClaudeClient } from "@/server/ai/claude";
import { summariseVoice } from "@/server/ai/voice-description";
import { prisma } from "@/server/db/client";
import type { Events } from "../events";
import { inngest } from "../client";

function estimateCostCents(input: number, output: number): number {
  return Math.round(input * 0.0003 + output * 0.0015);
}

/**
 * Re-derive `Show.voiceDescription` from the show's most-recently approved
 * voice samples. Triggered when the approved-sample count crosses one of the
 * refresh thresholds (see `server/ai/voice-strength.ts`).
 *
 * Failure modes:
 * - No samples yet → NonRetriable. The trigger logic shouldn't fire in that
 *   case, but we guard anyway.
 * - Claude error → retried up to 3× by Inngest.
 */
export const refreshVoiceDescription = inngest.createFunction(
  {
    id: "refresh-voice-description",
    triggers: [{ event: "voice/refresh.requested" }],
    retries: 3,
  },
  async ({ event, step }) => {
    const { showId } = event.data as Events["voice/refresh.requested"]["data"];

    const show = await prisma.show.findUnique({
      where: { id: showId },
      select: {
        id: true,
        name: true,
        host: true,
        client: { select: { agencyId: true } },
      },
    });
    if (!show) {
      throw new NonRetriableError(`Show ${showId} not found`);
    }
    const agencyId = show.client.agencyId;

    // Pull the latest 20 approved samples (mix of platforms). Recency-
    // weighted by default because samples are stamped on approval order.
    const samples = await prisma.voiceSample.findMany({
      where: { showId: show.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { platform: true, content: true },
    });
    if (samples.length === 0) {
      throw new NonRetriableError(`No approved samples for show ${showId} — nothing to summarise`);
    }

    const result = await step.run("summarise-voice", async () => {
      const c = requireClaudeClient();
      return summariseVoice(c, {
        clientName: show.name,
        hostName: show.host,
        samples,
      });
    });

    // Total approved-sample count at the moment we're locking in this
    // description. `shouldRefreshVoiceDescription` compares against this
    // to fire the next periodic refresh (post-30) and to throttle
    // drift-triggered refreshes. Read after `summariseVoice` so any
    // approvals landing during the Claude call are counted against this
    // snapshot (avoids a stuck drift trigger when refreshes overlap
    // with a fast approval stream).
    const sampleCountAtRefresh = await prisma.voiceSample.count({
      where: { showId: show.id },
    });

    await step.run("persist-description", () =>
      prisma.$transaction([
        prisma.show.update({
          where: { id: show.id },
          data: {
            voiceDescription: result.description,
            voiceDescriptionSampleCount: sampleCountAtRefresh,
            // Reset the operator's rating so the freshly-written
            // description can be rated on its own merit — including
            // when the trigger for this refresh was the operator
            // explicitly saying "not my voice" on the previous one.
            voiceDescriptionApproved: null,
          },
        }),
        prisma.usageLog.create({
          data: {
            agencyId,
            episodeId: null,
            model: CLAUDE_MODEL,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            costCents: estimateCostCents(result.inputTokens, result.outputTokens),
          },
        }),
      ]),
    );

    return {
      showId,
      sampleCount: samples.length,
      descriptionChars: result.description.length,
    };
  },
);
