import "server-only";

import { MemberRole, type Show } from "@prisma/client";
import { z } from "zod";
import { NotFoundError } from "@/server/auth/errors";
import { requireRole, type TenantContext } from "@/server/auth/tenant";
import { assertPlanCapacity, getAgencyPlan } from "@/server/billing/limits";
import { prisma } from "./client";

// ============================================================
// Input schemas — exposed for the route/server-action layer to validate
// user input. The repo functions accept the inferred types.
// ============================================================

export const createShowInput = z.object({
  clientId: z.string().min(1),
  name: z.string().min(1).max(120),
  host: z.string().min(1).max(120),
  description: z.string().max(2000).nullish(),
  artworkUrl: z.string().url().nullish(),
  rssUrl: z.string().url().nullish(),
});
export type CreateShowInput = z.infer<typeof createShowInput>;

export const updateShowInput = createShowInput.partial().omit({ clientId: true });
export type UpdateShowInput = z.infer<typeof updateShowInput>;

// ============================================================
// Role gates
// ============================================================

const READ_ROLES = [
  MemberRole.OWNER,
  MemberRole.ADMIN,
  MemberRole.EDITOR,
  MemberRole.REVIEWER,
] as const;

const WRITE_ROLES = [MemberRole.OWNER, MemberRole.ADMIN] as const;

// ============================================================
// Reads — Shows are tenanted via Client → Agency.
// ============================================================

export async function listShows(ctx: TenantContext): Promise<Show[]> {
  requireRole(ctx, READ_ROLES);
  return prisma.show.findMany({
    where: { client: { agencyId: ctx.agencyId } },
    orderBy: { createdAt: "desc" },
  });
}

export async function listShowsForClient(ctx: TenantContext, clientId: string): Promise<Show[]> {
  requireRole(ctx, READ_ROLES);
  return prisma.show.findMany({
    where: {
      clientId,
      client: { agencyId: ctx.agencyId },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getShow(ctx: TenantContext, showId: string): Promise<Show> {
  requireRole(ctx, READ_ROLES);
  const show = await prisma.show.findFirst({
    where: {
      id: showId,
      client: { agencyId: ctx.agencyId },
    },
  });
  if (!show) throw new NotFoundError(`Show ${showId} not found`);
  return show;
}

// ============================================================
// Mutations
// ============================================================

export async function createShow(ctx: TenantContext, input: CreateShowInput): Promise<Show> {
  requireRole(ctx, WRITE_ROLES);

  // Verify the parent client belongs to the current agency before creating —
  // prevents attaching a show to another tenant's client by sending its id.
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, agencyId: ctx.agencyId },
    select: { id: true },
  });
  if (!client) throw new NotFoundError(`Client ${input.clientId} not found`);

  // Show counts roll up to the agency's plan limit (shows are the metered
  // resource — clients are unlimited).
  const plan = await getAgencyPlan(ctx.agencyId);
  await assertPlanCapacity(ctx.agencyId, plan, "shows");

  return prisma.show.create({
    data: {
      clientId: input.clientId,
      name: input.name,
      host: input.host,
      description: input.description ?? null,
      artworkUrl: input.artworkUrl ?? null,
      rssUrl: input.rssUrl ?? null,
    },
  });
}

export async function updateShow(
  ctx: TenantContext,
  showId: string,
  patch: UpdateShowInput,
): Promise<Show> {
  requireRole(ctx, WRITE_ROLES);
  // updateMany returns a count rather than the row — we use it to enforce
  // the tenant filter atomically, then re-read the updated row.
  const { count } = await prisma.show.updateMany({
    where: {
      id: showId,
      client: { agencyId: ctx.agencyId },
    },
    data: patch,
  });
  if (count === 0) throw new NotFoundError(`Show ${showId} not found`);
  return prisma.show.findUniqueOrThrow({ where: { id: showId } });
}

export async function deleteShow(ctx: TenantContext, showId: string): Promise<void> {
  requireRole(ctx, WRITE_ROLES);
  const { count } = await prisma.show.deleteMany({
    where: {
      id: showId,
      client: { agencyId: ctx.agencyId },
    },
  });
  if (count === 0) throw new NotFoundError(`Show ${showId} not found`);
}
