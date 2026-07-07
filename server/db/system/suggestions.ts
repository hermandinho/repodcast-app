import "server-only";

import type { Prisma, SuggestionStatus, SuggestionType } from "@prisma/client";
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
 * ROOT-side triage for user-submitted feedback (`/root/feedback`). Reads
 * open to every system role; writes gated to ROOT + OPERATOR. Every status
 * transition lands a `SystemAuditLog` row in the same transaction as the
 * mutation.
 */

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;

const SUGGESTION_STATUS_VALUES = [
  "NEW",
  "TRIAGED",
  "PLANNED",
  "IN_PROGRESS",
  "SHIPPED",
  "WONTFIX",
] as const satisfies readonly SuggestionStatus[];

const SUGGESTION_TYPE_VALUES = [
  "BUG",
  "FEATURE_REQUEST",
  "IMPROVEMENT",
  "QUESTION",
  "OTHER",
] as const satisfies readonly SuggestionType[];

/** Terminal states — moving into one of these stamps `resolvedAt`. */
const TERMINAL_STATUSES: readonly SuggestionStatus[] = ["SHIPPED", "WONTFIX"];

export const SUGGESTION_STATUS_OPTIONS: readonly SuggestionStatus[] = SUGGESTION_STATUS_VALUES;
export const SUGGESTION_TYPE_OPTIONS: readonly SuggestionType[] = SUGGESTION_TYPE_VALUES;

// ============================================================
// Reads
// ============================================================

export type SuggestionRow = {
  id: string;
  type: SuggestionType;
  status: SuggestionStatus;
  title: string;
  body: string;
  contextUrl: string | null;
  resolution: string | null;
  reporterEmail: string;
  reporterName: string | null;
  agency: { id: string; name: string } | null;
  member: { id: string; email: string; name: string | null } | null;
  resolvedBy: { id: string; email: string; name: string | null } | null;
  createdAt: Date;
  resolvedAt: Date | null;
};

export const listSuggestionsInput = z.object({
  status: z.enum(SUGGESTION_STATUS_VALUES).optional(),
  type: z.enum(SUGGESTION_TYPE_VALUES).optional(),
  agencyId: z.string().trim().min(1).max(60).optional(),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  skip: z.coerce.number().int().min(0).default(0),
});
export type ListSuggestionsInput = z.input<typeof listSuggestionsInput>;

export async function listSuggestions(
  ctx: SystemAdminContext,
  rawInput: Partial<ListSuggestionsInput> = {},
): Promise<{ rows: SuggestionRow[]; total: number }> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const input = listSuggestionsInput.parse(rawInput);
  const where: Prisma.SuggestionWhereInput = {};
  if (input.status) where.status = input.status;
  if (input.type) where.type = input.type;
  if (input.agencyId) where.agencyId = input.agencyId;

  const [rows, total] = await Promise.all([
    prisma.suggestion.findMany({
      where,
      // Open rows first (NEW → TRIAGED → PLANNED → IN_PROGRESS → SHIPPED → WONTFIX),
      // then most-recent within each status. Postgres orders enums by declaration
      // order, which matches the lifecycle we want.
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: input.take,
      skip: input.skip,
      select: suggestionSelect,
    }),
    prisma.suggestion.count({ where }),
  ]);

  return { rows: rows.map(toSuggestionRow), total };
}

// ============================================================
// Writes
// ============================================================

export const updateSuggestionStatusInput = z.object({
  id: z.string().trim().min(1),
  status: z.enum(SUGGESTION_STATUS_VALUES),
  /**
   * Required when moving to a terminal state; ignored otherwise. Persisted
   * on the row itself so the ROOT queue reads "why we shipped / rejected"
   * without a join back to the audit log.
   */
  resolution: z.string().trim().min(3).max(2_000).optional(),
  /** Audit note; distinct from `resolution`. */
  note: z.string().trim().max(500).optional(),
});
export type UpdateSuggestionStatusInput = z.input<typeof updateSuggestionStatusInput>;

export async function updateSuggestionStatus(
  ctx: SystemAdminContext,
  rawInput: UpdateSuggestionStatusInput,
): Promise<SuggestionRow> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = updateSuggestionStatusInput.parse(rawInput);

  const existing = await prisma.suggestion.findUnique({
    where: { id: input.id },
    select: { agencyId: true, status: true },
  });
  if (!existing) throw new NotFoundError(`Suggestion ${input.id} not found`);

  const isTerminal = TERMINAL_STATUSES.includes(input.status);
  if (isTerminal && !input.resolution) {
    throw new ValidationError(
      "Resolution is required when moving a suggestion to SHIPPED or WONTFIX.",
    );
  }

  return withSystemAudit(
    ctx,
    {
      action: isTerminal
        ? SYSTEM_AUDIT_ACTIONS.SUGGESTION_RESOLVE
        : SYSTEM_AUDIT_ACTIONS.SUGGESTION_STATUS_CHANGE,
      targetAgencyId: existing.agencyId,
      targetEntityType: "suggestion",
      targetEntityId: input.id,
      note: input.note ?? null,
    },
    async (tx, audit) => {
      const before = await tx.suggestion.findUnique({
        where: { id: input.id },
        select: suggestionSelect,
      });
      if (!before) throw new NotFoundError(`Suggestion ${input.id} not found`);
      audit.setBefore(before);

      const after = await tx.suggestion.update({
        where: { id: input.id },
        data: {
          status: input.status,
          resolution: isTerminal ? input.resolution : before.resolution,
          resolvedAt: isTerminal ? new Date() : null,
          resolvedBySystemAdminId: isTerminal ? ctx.admin.id : null,
        },
        select: suggestionSelect,
      });
      audit.setAfter(after);
      return toSuggestionRow(after);
    },
  );
}

// ============================================================
// Helpers
// ============================================================

const suggestionSelect = {
  id: true,
  type: true,
  status: true,
  title: true,
  body: true,
  contextUrl: true,
  resolution: true,
  reporterEmail: true,
  reporterName: true,
  createdAt: true,
  resolvedAt: true,
  agency: { select: { id: true, name: true } },
  member: { select: { id: true, email: true, name: true } },
  resolvedBySystemAdmin: { select: { id: true, email: true, name: true } },
} satisfies Prisma.SuggestionSelect;

type RawSuggestion = Prisma.SuggestionGetPayload<{ select: typeof suggestionSelect }>;

function toSuggestionRow(r: RawSuggestion): SuggestionRow {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    title: r.title,
    body: r.body,
    contextUrl: r.contextUrl,
    resolution: r.resolution,
    reporterEmail: r.reporterEmail,
    reporterName: r.reporterName,
    agency: r.agency,
    member: r.member,
    resolvedBy: r.resolvedBySystemAdmin,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
  };
}
