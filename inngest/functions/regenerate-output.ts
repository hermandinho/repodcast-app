import { OutputStatus, type Platform } from "@prisma/client";
import { NonRetriableError } from "inngest";
import { CLAUDE_MODEL, requireClaudeClient } from "@/server/ai/claude";
import { buildMessages, extractText, type VoiceContext } from "@/server/ai/prompt-builder";
import { scoreOutput } from "@/server/ai/quality-score";
import { checkRuleAdherence } from "@/server/ai/rule-adherence";
import { parseVoiceRules } from "@/server/ai/rule-parser";
import { prisma } from "@/server/db/client";
import { captureInngestFailure } from "@/server/observability/sentry";
import type { Events } from "../events";
import { inngest } from "../client";

/**
 * Cost estimate per call — same heuristic as the multi-output orchestrator
 * (`generate-episode.ts`). Replace with real per-model pricing in Phase 1.11.
 */
function estimateCostCents(input: number, output: number): number {
  return Math.round(input * 0.0003 + output * 0.0015);
}

function truncateReason(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) return "Regeneration failed";
  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
}

/**
 * Handles `episode/regenerate.output.requested` for a single GeneratedOutput.
 *
 * The server action that fires this event has already called
 * `markOutputRegenerating` — so the row is already at status `GENERATING`,
 * with `version` bumped and `lastInstruction` set. This function picks up
 * from there: rebuilds the platform prompt with the optional instruction
 * injected, calls Claude, writes the new content + logs usage, and flips
 * status back to a reviewable state (READY or IN_REVIEW depending on
 * whether the regen was instruction-driven).
 */
export const regenerateOutput = inngest.createFunction(
  {
    id: "regenerate-output",
    triggers: [{ event: "episode/regenerate.output.requested" }],
    retries: 3,
    // Phase 3.5 — same priority + concurrency model as `generate-episode`.
    // Regenerate is the user-facing hot path (a Reviewer clicked "Try
    // again" and is staring at a spinner), so priority.run mattering here
    // is arguably more visible than on batch generation.
    priority: {
      run: "event.data.plan == 'NETWORK' ? 120 : 0",
    },
    // See `generate-episode.ts` for the CEL syntax rationale — `??` is
    // JS-only; Inngest's CEL uses `has() ? … : fallback`. Global limit
    // pinned at 5 to fit the Inngest free-plan ceiling.
    concurrency: [
      { limit: 5 },
      {
        scope: "fn",
        key: "has(event.data.agencyId) ? event.data.agencyId : event.id",
        limit: 3,
      },
    ],
    // After Inngest exhausts retries the row would dangle in GENERATING
    // forever. Flip it to FAILED + log the error in a transition so the
    // per-card error UI can render with a Try-again button.
    onFailure: async ({ event, error }) => {
      const { outputId } = event.data.event
        .data as Events["episode/regenerate.output.requested"]["data"];
      captureInngestFailure("regenerate_output", error, { outputId });
      const output = await prisma.generatedOutput.findUnique({
        where: { id: outputId },
        select: {
          episode: { select: { show: { select: { client: { select: { agencyId: true } } } } } },
        },
      });
      if (!output) return;
      const reason = truncateReason(error?.message ?? "Regeneration failed");
      await prisma.$transaction([
        prisma.generatedOutput.update({
          where: { id: outputId },
          data: { status: OutputStatus.FAILED },
        }),
        prisma.outputTransition.create({
          data: {
            agencyId: output.episode.show.client.agencyId,
            outputId,
            fromStatus: OutputStatus.GENERATING,
            toStatus: OutputStatus.FAILED,
            byMemberId: null,
            note: reason,
          },
        }),
      ]);
    },
  },
  async ({ event, step }) => {
    const { outputId, instruction } =
      event.data as Events["episode/regenerate.output.requested"]["data"];

    // ---- 1. Load output + episode + show + per-platform instructions ----
    const output = await prisma.generatedOutput.findUnique({
      where: { id: outputId },
      include: {
        episode: {
          include: {
            show: {
              include: {
                platformInstructions: true,
                client: { select: { agencyId: true } },
              },
            },
          },
        },
      },
    });
    if (!output) {
      throw new NonRetriableError(`Output ${outputId} not found`);
    }
    const episode = output.episode;
    const show = episode.show;
    const agencyId = show.client.agencyId;

    // ---- 2. Voice context ----
    const samples = await prisma.voiceSample.findMany({
      where: { showId: show.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { generatedOutput: { select: { editDistance: true } } },
    });
    const voice: VoiceContext = {
      clientName: show.name,
      hostName: show.host,
      voiceDescription: show.voiceDescription,
      globalInstructions: show.globalInstructions,
      perPlatformInstructions: Object.fromEntries(
        show.platformInstructions.map((p: { platform: Platform; rule: string }) => [
          p.platform,
          p.rule,
        ]),
      ) as Partial<Record<Platform, string>>,
      samples: samples.map((s) => ({
        platform: s.platform,
        content: s.content,
        editDistance: s.generatedOutput?.editDistance,
      })),
    };

    // ---- 3. Build prompt with the optional regenerate instruction + call Claude ----
    const result = await step.run("regenerate-call", async () => {
      const c = requireClaudeClient();
      const built = buildMessages({
        platform: output.platform,
        voice,
        transcript: episode.transcript,
        model: CLAUDE_MODEL,
        extraInstruction: instruction,
      });
      const response = await c.messages.create({
        model: built.model,
        max_tokens: built.maxTokens,
        system: built.system,
        messages: built.messages,
      });
      return {
        content: extractText(response),
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    });

    // ---- 4. Persist new content + usage in a single transaction ----
    // Status: an instruction-driven regen routes back to IN_REVIEW (the user
    // asked for a specific change and should review the result); an empty
    // regen goes to READY.
    const nextStatus =
      instruction && instruction.trim() ? OutputStatus.IN_REVIEW : OutputStatus.READY;

    // Re-check adherence against the freshly regenerated content. The
    // rules that applied at first-generation might have changed since
    // (operator edited them mid-review), so we always parse them from
    // the currently persisted state rather than caching from earlier.
    const constraints = [
      ...parseVoiceRules(show.globalInstructions),
      ...parseVoiceRules(
        show.platformInstructions.find((p) => p.platform === output.platform)?.rule,
      ),
    ];
    const ruleViolations = checkRuleAdherence(result.content, constraints);

    await step.run("persist-regenerated", () =>
      prisma.$transaction([
        prisma.generatedOutput.update({
          where: { id: outputId },
          data: {
            content: result.content,
            status: nextStatus,
            quality: scoreOutput(output.platform, result.content),
            ruleViolations,
          },
        }),
        prisma.outputTransition.create({
          data: {
            agencyId,
            outputId,
            fromStatus: OutputStatus.GENERATING,
            toStatus: nextStatus,
            byMemberId: null,
          },
        }),
        prisma.usageLog.create({
          data: {
            agencyId,
            episodeId: episode.id,
            model: CLAUDE_MODEL,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            costCents: estimateCostCents(result.inputTokens, result.outputTokens),
          },
        }),
      ]),
    );

    return {
      outputId,
      platform: output.platform,
      status: nextStatus,
    };
  },
);
