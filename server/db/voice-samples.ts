import "server-only";

import { MemberRole, Platform, type VoiceSample } from "@prisma/client";
import { scoreOutput } from "@/server/ai/quality-score";
import { NotFoundError } from "@/server/auth/errors";
import { requireReadRole, requireRole, type TenantContext } from "@/server/auth/tenant";
import { prisma } from "./client";

/**
 * Structural-quality floor for entry into the training pool. Below this,
 * an approved output is still persisted + shown to the reader — we just
 * don't teach the model to mimic its shape. Set low enough that typical
 * outputs (partial hashtag coverage, minor length drift) still clear it;
 * blocks obviously broken outputs (empty bodies, missing structure) from
 * polluting future few-shot prompts.
 *
 * `scoreOutput` returns 0–100 (50 length + 50 structure). Threshold
 * calibrated against `quality-score.ts` heuristics — cleared by most
 * platform outputs that hit their format even loosely.
 */
const SAMPLE_QUALITY_FLOOR = 30;

const READ_ROLES = [
  MemberRole.OWNER,
  MemberRole.ADMIN,
  MemberRole.EDITOR,
  MemberRole.REVIEWER,
] as const;

const APPROVE_ROLES = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.REVIEWER] as const;

// ============================================================
// Reads — samples are tenanted via Show → Client → Agency.
// ============================================================

export async function listVoiceSamplesForShow(
  ctx: TenantContext,
  showId: string,
): Promise<VoiceSample[]> {
  requireReadRole(ctx, READ_ROLES);
  return prisma.voiceSample.findMany({
    where: {
      showId,
      show: { client: { agencyId: ctx.agencyId } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Total approved voice samples per platform for a show. Drives the voice
 * strength meters across the UI (Weak 0–5 / Developing 6–15 / Strong 16+).
 */
export async function countSamplesByPlatform(
  ctx: TenantContext,
  showId: string,
): Promise<Record<Platform, number>> {
  requireReadRole(ctx, READ_ROLES);
  const rows = await prisma.voiceSample.groupBy({
    by: ["platform"],
    where: {
      showId,
      show: { client: { agencyId: ctx.agencyId } },
    },
    _count: { _all: true },
  });
  const totals: Record<Platform, number> = {
    TWITTER: 0,
    LINKEDIN: 0,
    INSTAGRAM: 0,
    TIKTOK: 0,
    SHOW_NOTES: 0,
    BLOG: 0,
    NEWSLETTER: 0,
  };
  for (const row of rows) totals[row.platform] = row._count._all;
  return totals;
}

// ============================================================
// Mutations
// ============================================================

/**
 * Create a sample from a freshly-approved GeneratedOutput. Verifies the
 * output belongs to a show in the current agency before writing.
 *
 * May return `null` when the output falls below the training-quality
 * floor — the approval itself still succeeds, we just don't add a badly-
 * shaped output to the show's few-shot pool.
 */
export async function createSampleFromOutput(
  ctx: TenantContext,
  outputId: string,
): Promise<VoiceSample | null> {
  requireRole(ctx, APPROVE_ROLES);
  return writeSampleFromOutput({ outputId, agencyId: ctx.agencyId });
}

/**
 * Portal-side variant of `createSampleFromOutput`. Used by
 * `clientApproveOutputFromPortal` where no `TenantContext` exists — the
 * caller has already validated the portal token and knows the agency id.
 * Scoping by (outputId, agencyId) still enforces tenancy.
 */
export async function createSampleFromOutputRaw(
  outputId: string,
  agencyId?: string,
): Promise<VoiceSample | null> {
  return writeSampleFromOutput({ outputId, agencyId });
}

async function writeSampleFromOutput(input: {
  outputId: string;
  agencyId?: string;
}): Promise<VoiceSample | null> {
  const output = await prisma.generatedOutput.findFirst({
    where: {
      id: input.outputId,
      ...(input.agencyId ? { episode: { show: { client: { agencyId: input.agencyId } } } } : {}),
    },
    select: {
      id: true,
      platform: true,
      content: true,
      episodeId: true,
      episode: { select: { showId: true } },
    },
  });
  if (!output) throw new NotFoundError(`Output ${input.outputId} not found`);

  // Quality gate — a broken or malformed output shouldn't teach the
  // model to reproduce it. Scored against the final (possibly edited)
  // content, since that's what future prompts would echo.
  if (scoreOutput(output.platform, output.content) < SAMPLE_QUALITY_FLOOR) {
    return null;
  }

  return prisma.voiceSample.create({
    data: {
      showId: output.episode.showId,
      platform: output.platform,
      content: output.content,
      generatedOutputId: output.id,
      episodeId: output.episodeId,
    },
  });
}
