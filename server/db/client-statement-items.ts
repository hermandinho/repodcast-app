import "server-only";

import { MemberRole, Prisma, type ClientStatementItem } from "@prisma/client";
import { z } from "zod";
import { NotFoundError } from "@/server/auth/errors";
import { requireRole, type TenantContext } from "@/server/auth/tenant";
import { prisma } from "./client";

/**
 * Line items on a `ClientStatement` — the billable rows the agency shows
 * the client. Read/write is OWNER/ADMIN only; every operation is anchored
 * to the parent statement's tenant via a join filter so cross-tenant ids
 * collapse to "not found" without leaking existence.
 */

const ADMIN_ROLES = [MemberRole.OWNER, MemberRole.ADMIN] as const;

// ============================================================
// Input schemas
// ============================================================

/**
 * Reject "0" and negative quantities at the input layer — a zero-quantity
 * row would render as a $0 charge, which is a data mistake in every
 * billing case we care about. Fractional units (e.g. 0.5 episodes) are
 * fine; the schema stores Decimal(10,2).
 */
const quantitySchema = z.coerce
  .number()
  .positive()
  .max(999_999)
  .refine((n) => Number.isFinite(n) && Math.round(n * 100) / 100 === n, {
    message: "Quantity supports at most 2 decimal places.",
  });

const unitAmountSchema = z.coerce
  .number()
  .int()
  .min(0)
  // Same 10M USD ceiling as retainer/rate — obviously-wrong typos rejected.
  .max(10_000_000_00);

const descriptionSchema = z.string().trim().min(1).max(200);

export const addStatementItemInput = z.object({
  description: descriptionSchema,
  quantity: quantitySchema,
  unitAmountCents: unitAmountSchema,
});

export const updateStatementItemInput = z.object({
  description: descriptionSchema.optional(),
  quantity: quantitySchema.optional(),
  unitAmountCents: unitAmountSchema.optional(),
});

// ============================================================
// Helpers
// ============================================================

/**
 * Load the statement's tenant + id in one hop. Every mutation goes
 * through this so the join filter (client.agencyId === ctx.agencyId)
 * is enforced once, in one place.
 */
async function loadStatementForMutation(
  ctx: TenantContext,
  statementId: string,
): Promise<{ id: string }> {
  const row = await prisma.clientStatement.findFirst({
    where: { id: statementId, client: { agencyId: ctx.agencyId } },
    select: { id: true },
  });
  if (!row) throw new NotFoundError(`Statement ${statementId} not found`);
  return row;
}

/**
 * Same, but scoped to a single item — resolves statementId + verifies
 * tenant. Returns both ids so callers can revalidate downstream paths.
 */
async function loadItemForMutation(
  ctx: TenantContext,
  itemId: string,
): Promise<{ id: string; statementId: string }> {
  const row = await prisma.clientStatementItem.findFirst({
    where: {
      id: itemId,
      statement: { client: { agencyId: ctx.agencyId } },
    },
    select: { id: true, statementId: true },
  });
  if (!row) throw new NotFoundError(`Statement item ${itemId} not found`);
  return row;
}

/**
 * `round(quantity × unitAmountCents)` as an integer. `Decimal` from
 * Prisma lands on the wire as a string, so callers pass a plain number
 * or a validated string; we normalise here.
 */
export function computeItemAmountCents(quantity: number, unitAmountCents: number): number {
  const raw = quantity * unitAmountCents;
  // Guard against floating-point drift on 2dp values like 0.1 × 10.
  return Math.round(raw);
}

// ============================================================
// Reads
// ============================================================

export async function listStatementItems(
  ctx: TenantContext,
  statementId: string,
): Promise<ClientStatementItem[]> {
  requireRole(ctx, ADMIN_ROLES);
  await loadStatementForMutation(ctx, statementId);
  return prisma.clientStatementItem.findMany({
    where: { statementId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

// ============================================================
// Writes
// ============================================================

export async function addStatementItem(
  ctx: TenantContext,
  statementId: string,
  raw: z.infer<typeof addStatementItemInput>,
): Promise<ClientStatementItem> {
  requireRole(ctx, ADMIN_ROLES);
  await loadStatementForMutation(ctx, statementId);

  // Place new rows at the end. `_max` returns null on an empty relation
  // so `?? -1` seeds the first row's sortOrder to 0.
  const { _max } = await prisma.clientStatementItem.aggregate({
    where: { statementId },
    _max: { sortOrder: true },
  });
  const nextOrder = (_max.sortOrder ?? -1) + 1;

  return prisma.clientStatementItem.create({
    data: {
      statementId,
      description: raw.description,
      quantity: new Prisma.Decimal(raw.quantity),
      unitAmountCents: raw.unitAmountCents,
      amountCents: computeItemAmountCents(raw.quantity, raw.unitAmountCents),
      sortOrder: nextOrder,
    },
  });
}

export async function updateStatementItem(
  ctx: TenantContext,
  itemId: string,
  raw: z.infer<typeof updateStatementItemInput>,
): Promise<ClientStatementItem> {
  requireRole(ctx, ADMIN_ROLES);
  await loadItemForMutation(ctx, itemId);

  // Read the current row so partial patches can recompute amount without
  // an extra round-trip after the update.
  const current = await prisma.clientStatementItem.findUniqueOrThrow({
    where: { id: itemId },
  });
  const nextQuantity = raw.quantity ?? Number(current.quantity);
  const nextUnit = raw.unitAmountCents ?? current.unitAmountCents;

  return prisma.clientStatementItem.update({
    where: { id: itemId },
    data: {
      description: raw.description ?? undefined,
      quantity: raw.quantity != null ? new Prisma.Decimal(raw.quantity) : undefined,
      unitAmountCents: raw.unitAmountCents ?? undefined,
      amountCents: computeItemAmountCents(nextQuantity, nextUnit),
    },
  });
}

export async function deleteStatementItem(ctx: TenantContext, itemId: string): Promise<void> {
  requireRole(ctx, ADMIN_ROLES);
  await loadItemForMutation(ctx, itemId);
  await prisma.clientStatementItem.delete({ where: { id: itemId } });
}

// ============================================================
// Aggregate — total across all items on a statement. Used by the list
// view, the PDF/CSV renderers, and the portal. Returns cents.
// ============================================================

export async function sumStatementItemAmount(statementId: string): Promise<number> {
  const { _sum } = await prisma.clientStatementItem.aggregate({
    where: { statementId },
    _sum: { amountCents: true },
  });
  return _sum.amountCents ?? 0;
}

/**
 * Batched variant for list surfaces — sums items across many statements
 * in one query. Returns a `Map<statementId, totalCents>`; statements
 * with no items are absent from the map (caller treats missing as 0).
 */
export async function sumStatementItemsForMany(
  statementIds: string[],
): Promise<Map<string, number>> {
  if (statementIds.length === 0) return new Map();
  const rows = await prisma.clientStatementItem.groupBy({
    by: ["statementId"],
    where: { statementId: { in: statementIds } },
    _sum: { amountCents: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.statementId, r._sum.amountCents ?? 0);
  return out;
}
