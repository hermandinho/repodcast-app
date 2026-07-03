import { EpisodeStatus, OutputStatus, type Platform, type Prisma } from "@prisma/client";
import { NonRetriableError } from "inngest";
import { CLAUDE_MODEL, requireClaudeClient } from "@/server/ai/claude";
import { extractKeyMoments } from "@/server/ai/key-moments";
import { buildMessages, extractText, type VoiceContext } from "@/server/ai/prompt-builder";
import { scoreOutput } from "@/server/ai/quality-score";
import { planLimitsFor } from "@/lib/plans";
import { prisma } from "@/server/db/client";
import { sendGenerationCompleteEmail } from "@/server/email/send";
import { trackServer } from "@/server/analytics/track";
import type { Events } from "../events";
import { inngest } from "../client";

/**
 * Naive token-cost estimate for Sonnet 4.6 (≈ $3/MTok in, $15/MTok out).
 * Refine when Phase 1.11 wires real pricing per model.
 */
function estimateCostCents(input: number, output: number): number {
  return Math.round(input * 0.0003 + output * 0.0015);
}

function monthStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * Normalize an `allSettled` rejection into a short, persistable message.
 * Trimmed to 500 chars so a stack-trace dump doesn't bloat the transition
 * row that powers the per-card error UI.
 */
function failureReasonOf(reason: unknown): string {
  const raw =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : (() => {
            try {
              return JSON.stringify(reason);
            } catch {
              return String(reason);
            }
          })();
  const trimmed = raw.trim();
  if (trimmed.length === 0) return "Generation failed";
  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
}

/**
 * Orchestrates the generation pipeline for one episode.
 *
 * Step strategy:
 * - Read-only DB fetches happen OUTSIDE `step.run` so they re-execute on
 *   retry with fresh data (and we avoid the JSONify-of-Date round-trip
 *   Inngest does to step.run return values).
 * - Side-effects that must run exactly once (status updates, generate calls,
 *   persist, completion event) are wrapped in `step.run`.
 * - Generation steps run via `Promise.allSettled` so a single-platform
 *   failure doesn't void the others.
 */
export const generateEpisode = inngest.createFunction(
  {
    id: "generate-episode",
    triggers: [{ event: "episode/generate.requested" }],
    retries: 3,
    // Phase 3.5 — priority queue.
    //
    // `priority.run` is evaluated at enqueue time against `event.data`.
    // NETWORK-tier dispatches jump 120 s ahead of anything queued in the
    // last two minutes, so a NETWORK batch fired at t=0 executes ahead
    // of a STUDIO episode queued at t=-90s. Non-NETWORK plans (and any
    // legacy events missing `plan`) get default priority (0).
    priority: {
      run: "event.data.plan == 'NETWORK' ? 120 : 0",
    },
    // Concurrency has two layers:
    //   - Global cap protects Anthropic rate limits and our monthly
    //     $-per-token budget from a runaway fan-out. Set to 5 to match
    //     the Inngest free-plan ceiling; raise once we upgrade the plan.
    //   - Per-agency cap keeps one agency's batch from monopolizing all
    //     global slots. A NETWORK batch of 20 episodes still consumes at
    //     most 3 slots at once; the other 2+ slots stay open for other
    //     agencies, and NETWORK's `priority.run` bump just means their
    //     next slot fires ahead of a queued STUDIO event.
    //
    // The per-agency key falls back to `event.id` when `agencyId` is
    // absent — that's a unique run token, so old events (pre-3.5) act
    // as if unbounded rather than sharing a bucket labeled `undefined`
    // (which would erroneously starve them all together).
    //
    // Expression grammar note: Inngest uses Google CEL, which does NOT
    // support the JS nullish-coalesce `??`. The idiomatic "coalesce
    // with fallback" is `has(x.y) ? x.y : fallback`, and accessing a
    // missing map key inside CEL raises an evaluation error — hence
    // the explicit `has()` guard.
    concurrency: [
      { limit: 5 },
      {
        scope: "fn",
        key: "has(event.data.agencyId) ? event.data.agencyId : event.id",
        limit: 3,
      },
    ],
  },
  async ({ event, step }) => {
    const { episodeId, platforms } = event.data as Events["episode/generate.requested"]["data"];

    // Wall-clock anchor for the `generation_completed` analytics event.
    // Reset on Inngest retries — that's fine; the event tracks the most
    // recent successful execution, which is the duration that mattered to
    // the user.
    const pipelineStart = Date.now();

    // ---- 1. Load episode + validate transcript ----
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      include: {
        show: {
          include: {
            platformInstructions: true,
            client: { select: { agencyId: true } },
          },
        },
      },
    });
    if (!episode) {
      throw new NonRetriableError(`Episode ${episodeId} not found`);
    }
    const wordCount = episode.transcript.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 500) {
      throw new NonRetriableError(`Transcript too short — ${wordCount} words (need ≥ 500)`);
    }

    const agencyId = episode.show.client.agencyId;

    // ---- 2. Cost-cap guard (per-plan) ----
    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
      select: { plan: true },
    });
    if (!agency) {
      throw new NonRetriableError(`Agency ${agencyId} not found`);
    }
    const monthlyCapCents = planLimitsFor(agency.plan).monthlyCostCapCents;
    const totals = await prisma.usageLog.aggregate({
      where: {
        agencyId,
        createdAt: { gte: monthStart() },
      },
      _sum: { costCents: true },
    });
    const spentCents = totals._sum.costCents ?? 0;
    if (spentCents >= monthlyCapCents) {
      throw new NonRetriableError(
        `Monthly cost cap reached for plan ${agency.plan} (${spentCents} of ${monthlyCapCents} cents)`,
      );
    }

    // ---- 3. Status → PROCESSING ----
    await step.run("mark-processing", () =>
      prisma.episode.update({
        where: { id: episodeId },
        data: { status: EpisodeStatus.PROCESSING },
      }),
    );

    // ---- 4. Extract key moments (one Claude call shared across platforms) ----
    const moments = await step.run("extract-moments", () => extractKeyMoments(episode.transcript));

    // Persist the moments on the Episode row so the `/episodes/[id]` page can
    // render clip suggestions without re-calling Claude. Wrapped in its own
    // step.run so retries don't repeat the write (and trackServer-style
    // failures stay local to this step).
    await step.run("persist-moments", () =>
      prisma.episode.update({
        where: { id: episodeId },
        data: { keyMoments: moments as unknown as Prisma.InputJsonValue },
      }),
    );

    // ---- 5. Voice context ----
    const samples = await prisma.voiceSample.findMany({
      where: { showId: episode.showId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const voice: VoiceContext = {
      clientName: episode.show.name,
      hostName: episode.show.host,
      voiceDescription: episode.show.voiceDescription,
      globalInstructions: episode.show.globalInstructions,
      perPlatformInstructions: Object.fromEntries(
        episode.show.platformInstructions.map((p) => [p.platform, p.rule]),
      ) as Partial<Record<Platform, string>>,
      samples: samples.map((s) => ({ platform: s.platform, content: s.content })),
    };

    // ---- 6. Fan out — parallel generation per platform ----
    const transcriptWithMoments = `${episode.transcript}\n\n--- KEY MOMENTS ---\n${JSON.stringify(moments, null, 2)}`;

    const settled = await Promise.allSettled(
      platforms.map((platform: Platform) =>
        step.run(`generate-${platform.toLowerCase()}`, async () => {
          const client = requireClaudeClient();
          const built = buildMessages({
            platform,
            voice,
            transcript: transcriptWithMoments,
            model: CLAUDE_MODEL,
          });
          const response = await client.messages.create({
            model: built.model,
            max_tokens: built.maxTokens,
            system: built.system,
            messages: built.messages,
          });
          return {
            platform,
            content: extractText(response),
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
          };
        }),
      ),
    );

    type StepResult = {
      platform: Platform;
      content: string;
      inputTokens: number;
      outputTokens: number;
    };

    const successful = settled
      .map((r, i) => ({ result: r, platform: platforms[i] }))
      .filter(
        (x): x is { result: PromiseFulfilledResult<StepResult>; platform: Platform } =>
          x.result.status === "fulfilled",
      )
      .map((x) => x.result.value);

    const failed = settled
      .map((r, i) => ({ result: r, platform: platforms[i] }))
      .filter(
        (x): x is { result: PromiseRejectedResult; platform: Platform } =>
          x.result.status === "rejected",
      )
      .map((x) => ({
        platform: x.platform,
        reason: failureReasonOf(x.result.reason),
      }));

    const failedPlatforms: Platform[] = failed.map((f) => f.platform);

    // ---- 7. Persist successful + FAILED placeholder rows + usage logs + transitions ----
    // Interactive transaction so we can attach each transition row to the
    // freshly-created output's id (single-write transaction-array semantics
    // can't fan one create's output into a second create's input).
    // FAILED rows are persisted alongside successes so the UI grid always
    // shows every requested platform — silent absence was the bug 1.7 fixed.
    if (successful.length > 0 || failed.length > 0) {
      await step.run("persist-outputs", () =>
        prisma.$transaction(async (tx) => {
          for (const g of successful) {
            const created = await tx.generatedOutput.create({
              data: {
                episodeId,
                platform: g.platform,
                content: g.content,
                status: OutputStatus.READY,
                quality: scoreOutput(g.platform, g.content),
              },
            });
            await tx.outputTransition.create({
              data: {
                agencyId: agencyId,
                outputId: created.id,
                fromStatus: null,
                toStatus: OutputStatus.READY,
                byMemberId: null,
              },
            });
            await tx.usageLog.create({
              data: {
                agencyId: agencyId,
                episodeId,
                model: CLAUDE_MODEL,
                inputTokens: g.inputTokens,
                outputTokens: g.outputTokens,
                costCents: estimateCostCents(g.inputTokens, g.outputTokens),
              },
            });
          }
          for (const f of failed) {
            const created = await tx.generatedOutput.create({
              data: {
                episodeId,
                platform: f.platform,
                content: "",
                status: OutputStatus.FAILED,
              },
            });
            await tx.outputTransition.create({
              data: {
                agencyId: agencyId,
                outputId: created.id,
                fromStatus: null,
                toStatus: OutputStatus.FAILED,
                byMemberId: null,
                note: f.reason,
              },
            });
          }
        }),
      );
    }

    // ---- 7a. Telemetry — one `generation_completed` per platform that
    //         actually persisted. Best-effort; trackServer never throws.
    if (successful.length > 0) {
      const durationMs = Date.now() - pipelineStart;
      await Promise.allSettled(
        successful.map((g) =>
          trackServer(
            "generation_completed",
            {
              episodeId,
              platform: g.platform,
              outputTokens: g.outputTokens,
              durationMs,
            },
            { distinctId: `agency:${agencyId}`, agencyId },
          ),
        ),
      );
    }

    // ---- 8. Episode → READY (even on partial failure) ----
    // Combine the status flip with a post-update READY-count so we can fire
    // the onboarding funnel's `first_episode_generated` exactly once per
    // agency. step.run memoization keeps this idempotent across retries.
    const wasFirstReadyEpisode = await step.run("mark-ready", async () => {
      await prisma.episode.update({
        where: { id: episodeId },
        data: { status: EpisodeStatus.READY },
      });
      const readyCount = await prisma.episode.count({
        where: {
          show: { client: { agencyId } },
          status: EpisodeStatus.READY,
        },
      });
      return readyCount === 1;
    });

    if (wasFirstReadyEpisode) {
      // Wrapping the track in its own step.run so retries don't re-fire it
      // (trackServer never throws, so this just memoizes the no-op result).
      await step.run("track-first-episode", async () => {
        await trackServer(
          "first_episode_generated",
          { agencyId, episodeId },
          { distinctId: `agency:${agencyId}`, agencyId },
        );
      });
    }

    // ---- 9. Notify owners/admins via email (best-effort; failures don't fail the run) ----
    await step.run("send-completion-email", async () => {
      const recipients = await prisma.member.findMany({
        where: {
          agencyId: agencyId,
          role: { in: ["OWNER", "ADMIN"] },
          NOT: { email: { endsWith: "@clerk.local" } },
        },
        select: { email: true, name: true },
      });
      const episodeUrl = `${appBaseUrl()}/episodes/${episodeId}`;
      await Promise.all(
        recipients.map((r) =>
          sendGenerationCompleteEmail(r.email, {
            recipientName: r.name?.split(" ")[0] ?? "there",
            episodeTitle: episode.title,
            clientName: episode.show.name,
            outputCount: successful.length,
            failedPlatforms,
            episodeUrl,
          }),
        ),
      );
      return { sent: recipients.length };
    });

    // ---- 10. Emit completion event for SSE + downstream listeners ----
    await step.sendEvent("episode-generated", {
      name: "episode/generated",
      data: {
        episodeId,
        outputCount: successful.length,
        failedPlatforms,
      },
    });

    return {
      episodeId,
      outputCount: successful.length,
      failedPlatforms,
    };
  },
);

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}
