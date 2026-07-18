import "server-only";

import type { Prisma, SupportTicketCategory, SupportTicketStatus } from "@prisma/client";
import { z } from "zod";
import {
  assertSystemRole,
  SYSTEM_READ_ROLES,
  SYSTEM_WRITE_ROLES,
  type SystemAdminContext,
} from "@/server/auth/system";
import { NotFoundError, ValidationError } from "@/server/auth/errors";
import { prisma } from "@/server/db/client";
import { SYSTEM_AUDIT_ACTIONS } from "./audit-actions";
import { withSystemAudit } from "./audit";

/**
 * ROOT-side triage for public support tickets (`/root/support`). Reads open
 * to every system role; writes gated to ROOT + OPERATOR. Every status
 * transition lands a `SystemAuditLog` row in the same transaction as the
 * mutation.
 *
 * Parallel to `server/db/system/suggestions.ts` — same shape, different
 * subject. See `/contact` for the public submission path.
 */

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;

const SUPPORT_TICKET_STATUS_VALUES = [
  "NEW",
  "OPEN",
  "WAITING_ON_USER",
  "RESOLVED",
  "CLOSED",
] as const satisfies readonly SupportTicketStatus[];

const SUPPORT_TICKET_CATEGORY_VALUES = [
  "BUG",
  "QUESTION",
  "BILLING",
  "ACCOUNT",
  "FEATURE_REQUEST",
  "OTHER",
] as const satisfies readonly SupportTicketCategory[];

/** Terminal states — moving into one of these stamps `resolvedAt`. */
const TERMINAL_STATUSES: readonly SupportTicketStatus[] = ["RESOLVED", "CLOSED"];

export const SUPPORT_TICKET_STATUS_OPTIONS: readonly SupportTicketStatus[] =
  SUPPORT_TICKET_STATUS_VALUES;
export const SUPPORT_TICKET_CATEGORY_OPTIONS: readonly SupportTicketCategory[] =
  SUPPORT_TICKET_CATEGORY_VALUES;

// ============================================================
// Reads
// ============================================================

export type SupportTicketRow = {
  id: string;
  refCode: string;
  category: SupportTicketCategory;
  status: SupportTicketStatus;
  subject: string;
  body: string;
  contextUrl: string | null;
  resolution: string | null;
  submitterName: string;
  submitterEmail: string;
  agency: { id: string; name: string } | null;
  member: { id: string; email: string; name: string | null } | null;
  resolvedBy: { id: string; email: string; name: string | null } | null;
  createdAt: Date;
  resolvedAt: Date | null;
};

export const listSupportTicketsInput = z.object({
  status: z.enum(SUPPORT_TICKET_STATUS_VALUES).optional(),
  category: z.enum(SUPPORT_TICKET_CATEGORY_VALUES).optional(),
  agencyId: z.string().trim().min(1).max(60).optional(),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  skip: z.coerce.number().int().min(0).default(0),
});
export type ListSupportTicketsInput = z.input<typeof listSupportTicketsInput>;

export async function listSupportTickets(
  ctx: SystemAdminContext,
  rawInput: Partial<ListSupportTicketsInput> = {},
): Promise<{ rows: SupportTicketRow[]; total: number }> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const input = listSupportTicketsInput.parse(rawInput);
  const where: Prisma.SupportTicketWhereInput = {};
  if (input.status) where.status = input.status;
  if (input.category) where.category = input.category;
  if (input.agencyId) where.agencyId = input.agencyId;

  const [rows, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      // Open rows first (NEW → OPEN → WAITING_ON_USER → RESOLVED → CLOSED),
      // then most-recent within each status. Postgres orders enums by
      // declaration order, which matches the lifecycle we want.
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: input.take,
      skip: input.skip,
      select: supportTicketSelect,
    }),
    prisma.supportTicket.count({ where }),
  ]);

  return { rows: rows.map(toSupportTicketRow), total };
}

// ============================================================
// Writes
// ============================================================

export const updateSupportTicketStatusInput = z.object({
  id: z.string().trim().min(1),
  status: z.enum(SUPPORT_TICKET_STATUS_VALUES),
  /**
   * Required when moving to a terminal state; ignored otherwise. Persisted
   * on the row itself so the queue reads "how it was resolved" without a
   * join back to the audit log.
   */
  resolution: z.string().trim().min(3).max(2_000).optional(),
  /** Audit note; distinct from `resolution`. */
  note: z.string().trim().max(500).optional(),
});
export type UpdateSupportTicketStatusInput = z.input<typeof updateSupportTicketStatusInput>;

export async function updateSupportTicketStatus(
  ctx: SystemAdminContext,
  rawInput: UpdateSupportTicketStatusInput,
): Promise<SupportTicketRow> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = updateSupportTicketStatusInput.parse(rawInput);

  const existing = await prisma.supportTicket.findUnique({
    where: { id: input.id },
    select: { agencyId: true, status: true },
  });
  if (!existing) throw new NotFoundError(`SupportTicket ${input.id} not found`);

  const isTerminal = TERMINAL_STATUSES.includes(input.status);
  if (isTerminal && !input.resolution) {
    throw new ValidationError("Resolution is required when moving a ticket to RESOLVED or CLOSED.");
  }

  return withSystemAudit(
    ctx,
    {
      action: isTerminal
        ? SYSTEM_AUDIT_ACTIONS.SUPPORT_TICKET_RESOLVE
        : SYSTEM_AUDIT_ACTIONS.SUPPORT_TICKET_STATUS_CHANGE,
      targetAgencyId: existing.agencyId,
      targetEntityType: "support_ticket",
      targetEntityId: input.id,
      note: input.note ?? null,
    },
    async (tx, audit) => {
      const before = await tx.supportTicket.findUnique({
        where: { id: input.id },
        select: supportTicketSelect,
      });
      if (!before) throw new NotFoundError(`SupportTicket ${input.id} not found`);
      audit.setBefore(before);

      const after = await tx.supportTicket.update({
        where: { id: input.id },
        data: {
          status: input.status,
          resolution: isTerminal ? input.resolution : before.resolution,
          resolvedAt: isTerminal ? new Date() : null,
          resolvedBySystemAdminId: isTerminal ? ctx.admin.id : null,
        },
        select: supportTicketSelect,
      });
      audit.setAfter(after);
      return toSupportTicketRow(after);
    },
  );
}

// ============================================================
// Helpers
// ============================================================

const supportTicketSelect = {
  id: true,
  refCode: true,
  category: true,
  status: true,
  subject: true,
  body: true,
  contextUrl: true,
  resolution: true,
  name: true,
  email: true,
  createdAt: true,
  resolvedAt: true,
  agency: { select: { id: true, name: true } },
  member: { select: { id: true, email: true, name: true } },
  resolvedBySystemAdmin: { select: { id: true, email: true, name: true } },
} satisfies Prisma.SupportTicketSelect;

type RawSupportTicket = Prisma.SupportTicketGetPayload<{ select: typeof supportTicketSelect }>;

function toSupportTicketRow(r: RawSupportTicket): SupportTicketRow {
  return {
    id: r.id,
    refCode: r.refCode,
    category: r.category,
    status: r.status,
    subject: r.subject,
    body: r.body,
    contextUrl: r.contextUrl,
    resolution: r.resolution,
    submitterName: r.name,
    submitterEmail: r.email,
    agency: r.agency,
    member: r.member,
    resolvedBy: r.resolvedBySystemAdmin,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
  };
}
