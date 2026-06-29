import "server-only";

import {
  EpisodeStatus,
  MemberRole,
  type Prisma,
  TranscriptSource,
  type Episode,
} from "@prisma/client";
import { z } from "zod";
import { NotFoundError } from "@/server/auth/errors";
import { requireRole, type TenantContext } from "@/server/auth/tenant";
import { assertPlanCapacity, getAgencyPlan } from "@/server/billing/limits";
import { prisma } from "./client";

// ============================================================
// Input schemas
// ============================================================

export const listEpisodesFilterInput = z.object({
  /** Case-insensitive substring match on Episode.title. */
  search: z.string().trim().max(200).optional(),
  status: z.nativeEnum(EpisodeStatus).optional(),
  showId: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  /** Inclusive lower bound on `Episode.createdAt`. */
  from: z.coerce.date().optional(),
  /** Inclusive upper bound on `Episode.createdAt`. */
  to: z.coerce.date().optional(),
  take: z.number().int().min(1).max(100).default(25),
  skip: z.number().int().min(0).default(0),
});
export type ListEpisodesFilterInput = z.infer<typeof listEpisodesFilterInput>;

export const createEpisodeInput = z.object({
  showId: z.string().min(1),
  title: z.string().min(1).max(240),
  transcript: z.string().min(500, "Transcript must be at least 500 characters"),
  source: z.nativeEnum(TranscriptSource),
  audioUrl: z.string().url().nullish(),
  externalUrl: z.string().url().nullish(),
  recordedAt: z.date().nullish(),
  durationSec: z.number().int().positive().nullish(),
});
export type CreateEpisodeInput = z.infer<typeof createEpisodeInput>;

// ============================================================
// Role gates
// ============================================================

const READ_ROLES = [
  MemberRole.OWNER,
  MemberRole.ADMIN,
  MemberRole.EDITOR,
  MemberRole.REVIEWER,
] as const;

const WRITE_ROLES = [MemberRole.OWNER, MemberRole.ADMIN, MemberRole.EDITOR] as const;

// ============================================================
// Reads — Episodes are tenanted via Show → Client → Agency. Every read
// filters through `show.client.agencyId === ctx.agencyId` so episodes in
// other tenants are invisible regardless of which id the caller hands us.
// ============================================================

export async function listEpisodes(ctx: TenantContext): Promise<Episode[]> {
  requireRole(ctx, READ_ROLES);
  return prisma.episode.findMany({
    where: { show: { client: { agencyId: ctx.agencyId } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function listEpisodesForShow(ctx: TenantContext, showId: string): Promise<Episode[]> {
  requireRole(ctx, READ_ROLES);
  return prisma.episode.findMany({
    where: {
      showId,
      show: { client: { agencyId: ctx.agencyId } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Build the tenant-scoped `where` clause for the filtered list/count helpers.
 * Tenancy is always enforced via `show.client.agencyId`; optional filters are
 * appended only when set so a fresh `/episodes` view returns everything.
 */
function buildEpisodeListWhere(
  ctx: TenantContext,
  filters: Omit<ListEpisodesFilterInput, "take" | "skip">,
): Prisma.EpisodeWhereInput {
  const clientWhere: Prisma.ClientWhereInput = {
    agencyId: ctx.agencyId,
    ...(filters.clientId ? { id: filters.clientId } : {}),
  };
  const where: Prisma.EpisodeWhereInput = {
    show: {
      client: clientWhere,
      ...(filters.showId ? { id: filters.showId } : {}),
    },
  };
  if (filters.status) where.status = filters.status;
  if (filters.search && filters.search.length > 0) {
    where.title = { contains: filters.search, mode: "insensitive" };
  }
  // The `to` bound is end-of-day inclusive — the picker hands us a midnight
  // boundary and the natural "I want all episodes through Jun 24" semantics
  // means up to 23:59:59 on that day.
  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: endOfDay(filters.to) } : {}),
    };
  }
  return where;
}

function endOfDay(d: Date): Date {
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  return end;
}

export type EpisodeListRow = Episode & {
  show: {
    id: string;
    name: string;
    host: string;
    client: { id: string; name: string };
  };
  _count: { outputs: number };
};

/**
 * Paginated, filtered list for the `/episodes` index. Returns rows + the
 * total count so the UI can render "showing N of M" + prev/next controls.
 * Output count uses `supersededAt: null` to match what the grid shows.
 */
export async function listEpisodesFiltered(
  ctx: TenantContext,
  raw: ListEpisodesFilterInput,
): Promise<{ rows: EpisodeListRow[]; total: number }> {
  requireRole(ctx, READ_ROLES);
  const where = buildEpisodeListWhere(ctx, raw);

  const [rows, total] = await Promise.all([
    prisma.episode.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: raw.take,
      skip: raw.skip,
      include: {
        show: {
          select: {
            id: true,
            name: true,
            host: true,
            client: { select: { id: true, name: true } },
          },
        },
        _count: { select: { outputs: { where: { supersededAt: null } } } },
      },
    }),
    prisma.episode.count({ where }),
  ]);

  return { rows, total };
}

export async function getEpisode(ctx: TenantContext, episodeId: string): Promise<Episode> {
  requireRole(ctx, READ_ROLES);
  const episode = await prisma.episode.findFirst({
    where: {
      id: episodeId,
      show: { client: { agencyId: ctx.agencyId } },
    },
  });
  if (!episode) throw new NotFoundError(`Episode ${episodeId} not found`);
  return episode;
}

// ============================================================
// Mutations
// ============================================================

export async function createEpisode(
  ctx: TenantContext,
  input: CreateEpisodeInput,
): Promise<Episode> {
  requireRole(ctx, WRITE_ROLES);

  // Verify the target show belongs to the current agency (via its client)
  // before creating — otherwise a caller could attach an episode to another
  // tenant's show by sending its id.
  const show = await prisma.show.findFirst({
    where: {
      id: input.showId,
      client: { agencyId: ctx.agencyId },
    },
    select: { id: true },
  });
  if (!show) throw new NotFoundError(`Show ${input.showId} not found`);

  const plan = await getAgencyPlan(ctx.agencyId);
  await assertPlanCapacity(ctx.agencyId, plan, "episodes");

  return prisma.episode.create({
    data: {
      showId: input.showId,
      title: input.title,
      transcript: input.transcript,
      source: input.source,
      audioUrl: input.audioUrl ?? null,
      externalUrl: input.externalUrl ?? null,
      recordedAt: input.recordedAt ?? null,
      durationSec: input.durationSec ?? null,
    },
  });
}
