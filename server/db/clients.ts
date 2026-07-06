import "server-only";

import { MemberRole, ValidationMode, type Client } from "@prisma/client";
import { z } from "zod";
import { NotFoundError } from "@/server/auth/errors";
import { requireReadRole, requireRole, type TenantContext } from "@/server/auth/tenant";
import { prisma } from "./client";

// ============================================================
// Input schemas
// ============================================================

export const createClientInput = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullish(),
  contactName: z.string().max(120).nullish(),
  contactEmail: z.string().email().max(320).nullish(),
  artworkUrl: z.string().url().nullish(),
});
export type CreateClientInput = z.infer<typeof createClientInput>;

export const updateClientInput = createClientInput.partial();
export type UpdateClientInput = z.infer<typeof updateClientInput>;

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
// Reads
// ============================================================

export async function listClients(ctx: TenantContext): Promise<Client[]> {
  requireReadRole(ctx, READ_ROLES);
  return prisma.client.findMany({
    where: { agencyId: ctx.agencyId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getClient(ctx: TenantContext, clientId: string): Promise<Client> {
  requireReadRole(ctx, READ_ROLES);
  const client = await prisma.client.findFirst({
    where: { id: clientId, agencyId: ctx.agencyId },
  });
  if (!client) throw new NotFoundError(`Client ${clientId} not found`);
  return client;
}

// ============================================================
// Mutations
// ============================================================
//
// Clients are unmetered — the plan limit lives on Shows, since shows are
// what consumes generation cost. So no `assertPlanCapacity` here.

export async function createClient(ctx: TenantContext, input: CreateClientInput): Promise<Client> {
  requireRole(ctx, WRITE_ROLES);
  return prisma.client.create({
    data: {
      agencyId: ctx.agencyId,
      name: input.name,
      description: input.description ?? null,
      contactName: input.contactName ?? null,
      contactEmail: input.contactEmail ?? null,
      artworkUrl: input.artworkUrl ?? null,
    },
  });
}

export async function updateClient(
  ctx: TenantContext,
  clientId: string,
  patch: UpdateClientInput,
): Promise<Client> {
  requireRole(ctx, WRITE_ROLES);
  const { count } = await prisma.client.updateMany({
    where: { id: clientId, agencyId: ctx.agencyId },
    data: patch,
  });
  if (count === 0) throw new NotFoundError(`Client ${clientId} not found`);
  return prisma.client.findUniqueOrThrow({ where: { id: clientId } });
}

export async function deleteClient(ctx: TenantContext, clientId: string): Promise<void> {
  requireRole(ctx, WRITE_ROLES);
  // Cascade deletes the client's shows, their episodes, outputs, etc.
  const { count } = await prisma.client.deleteMany({
    where: { id: clientId, agencyId: ctx.agencyId },
  });
  if (count === 0) throw new NotFoundError(`Client ${clientId} not found`);
}

// ============================================================
// Workflow settings — validation mode + notification recipients
// ============================================================

const notificationEmailSchema = z.string().trim().toLowerCase().email().max(320);

export const updateClientWorkflowInput = z.object({
  validationMode: z.nativeEnum(ValidationMode),
  /** Extra recipients that receive workflow notification emails on top of
   *  the agency's OWNER/ADMIN members. Deduped + case-normalized on write;
   *  capped at 10 so the field can't turn into a broadcast list. */
  notificationEmails: z.array(notificationEmailSchema).max(10),
});
export type UpdateClientWorkflowInput = z.infer<typeof updateClientWorkflowInput>;

export async function updateClientWorkflow(
  ctx: TenantContext,
  clientId: string,
  input: UpdateClientWorkflowInput,
): Promise<Client> {
  requireRole(ctx, WRITE_ROLES);
  const emails = Array.from(new Set(input.notificationEmails));
  const { count } = await prisma.client.updateMany({
    where: { id: clientId, agencyId: ctx.agencyId },
    data: {
      validationMode: input.validationMode,
      notificationEmails: emails,
    },
  });
  if (count === 0) throw new NotFoundError(`Client ${clientId} not found`);
  return prisma.client.findUniqueOrThrow({ where: { id: clientId } });
}
