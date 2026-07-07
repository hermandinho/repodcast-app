import "server-only";

import { MemberRole } from "@prisma/client";
import { requireReadRole, type TenantContext } from "@/server/auth/tenant";
import { prisma } from "./client";

const READ_ROLES = [
  MemberRole.OWNER,
  MemberRole.ADMIN,
  MemberRole.EDITOR,
  MemberRole.REVIEWER,
] as const;

export type SearchClientHit = { id: string; name: string };
export type SearchShowHit = {
  id: string;
  name: string;
  host: string;
  client: { id: string; name: string };
};
export type SearchEpisodeHit = {
  id: string;
  title: string;
  createdAt: Date;
  show: { id: string; name: string; client: { id: string; name: string } };
};

export type SearchAgencyResult = {
  clients: SearchClientHit[];
  shows: SearchShowHit[];
  episodes: SearchEpisodeHit[];
};

const EMPTY: SearchAgencyResult = { clients: [], shows: [], episodes: [] };

/**
 * Agency-wide search across clients, shows, and episodes. Case-insensitive
 * substring match on the primary name/title fields (plus host for shows).
 * Three parallel queries, capped at `limit` each — the palette shows one
 * bucket per kind and truncates further with a "…" affordance in the UI.
 *
 * Queries shorter than 2 chars short-circuit to empty; `%%` would scan the
 * entire tenant otherwise.
 */
export async function searchAgency(
  ctx: TenantContext,
  q: string,
  limit = 5,
): Promise<SearchAgencyResult> {
  requireReadRole(ctx, READ_ROLES);
  const needle = q.trim();
  if (needle.length < 2) return EMPTY;

  const [clients, shows, episodes] = await Promise.all([
    prisma.client.findMany({
      where: {
        agencyId: ctx.agencyId,
        name: { contains: needle, mode: "insensitive" },
      },
      select: { id: true, name: true },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    prisma.show.findMany({
      where: {
        client: { agencyId: ctx.agencyId },
        OR: [
          { name: { contains: needle, mode: "insensitive" } },
          { host: { contains: needle, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        host: true,
        client: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
    prisma.episode.findMany({
      where: {
        show: { client: { agencyId: ctx.agencyId } },
        title: { contains: needle, mode: "insensitive" },
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        show: {
          select: {
            id: true,
            name: true,
            client: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    }),
  ]);

  return { clients, shows, episodes };
}
