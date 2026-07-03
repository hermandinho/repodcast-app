import "server-only";

import { MemberRole, Platform, type VoiceSample } from "@prisma/client";
import { NotFoundError } from "@/server/auth/errors";
import { requireReadRole, requireRole, type TenantContext } from "@/server/auth/tenant";
import { prisma } from "./client";

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
 */
export async function createSampleFromOutput(
  ctx: TenantContext,
  outputId: string,
): Promise<VoiceSample> {
  requireRole(ctx, APPROVE_ROLES);

  const output = await prisma.generatedOutput.findFirst({
    where: {
      id: outputId,
      episode: { show: { client: { agencyId: ctx.agencyId } } },
    },
    select: {
      id: true,
      platform: true,
      content: true,
      episodeId: true,
      episode: { select: { showId: true } },
    },
  });
  if (!output) throw new NotFoundError(`Output ${outputId} not found`);

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
