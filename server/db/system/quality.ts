import "server-only";

import {
  type AbuseReportCategory,
  type AbuseReportStatus,
  type Platform,
  type Prisma,
} from "@prisma/client";
import { z } from "zod";
import {
  assertSystemRole,
  SYSTEM_READ_ROLES,
  SYSTEM_WRITE_ROLES,
  type SystemAdminContext,
} from "@/server/auth/system";
import { NotFoundError } from "@/server/auth/errors";
import { prisma } from "@/server/db/client";
import { SYSTEM_AUDIT_ACTIONS } from "./audit-actions";
import { withSystemAudit } from "./audit";

/**
 * Phase 3.6.10 — quality, abuse, and moderation.
 *
 * Two orthogonal read surfaces sharing the same admin page:
 *
 *   - AbuseReport queue — inbound complaints (spam, copyright, impersonation,
 *     harassment). Two ingress paths (both funnel here): a future public
 *     `/legal/report` form + manual entry via `createAbuseReport` for
 *     phoned-in complaints. Every triage step (assign → resolve / dismiss)
 *     is wrapped in `withSystemAudit`.
 *
 *   - Flagged outputs — cross-agency list of `GeneratedOutput` rows with
 *     `flaggedAt IS NOT NULL`. v1 has no tenant-facing "flag" UI (Phase 4);
 *     ROOT-initiated flags land through `flagOutput` here.
 *
 * Role posture:
 *   - Reads open to every system role (`SYSTEM_READ_ROLES`).
 *   - Writes gated to `SYSTEM_WRITE_ROLES` (ROOT + OPERATOR). SUPPORT can
 *     view but not act; ANALYST likewise.
 */

// ============================================================
// Abuse reports — types
// ============================================================

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;

export type AbuseReportRow = {
  id: string;
  reportedByEmail: string | null;
  category: AbuseReportCategory;
  status: AbuseReportStatus;
  body: string;
  targetAgencyId: string | null;
  targetAgencyName: string | null;
  targetMemberId: string | null;
  targetOutputId: string | null;
  resolution: string | null;
  assignedTo: { id: string; email: string; name: string | null } | null;
  createdAt: Date;
  resolvedAt: Date | null;
  updatedAt: Date;
};

// ============================================================
// Abuse reports — reads
// ============================================================

const ABUSE_REPORT_STATUS_VALUES = ["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"] as const;
const ABUSE_REPORT_CATEGORY_VALUES = [
  "SPAM",
  "COPYRIGHT",
  "IMPERSONATION",
  "HARASSMENT",
  "OTHER",
] as const;

export const listAbuseReportsInput = z.object({
  status: z.enum(ABUSE_REPORT_STATUS_VALUES).optional(),
  category: z.enum(ABUSE_REPORT_CATEGORY_VALUES).optional(),
  /** SystemAdmin.id — filter to reports assigned to this operator. */
  assignedToSystemAdminId: z.string().trim().min(1).max(60).optional(),
  /** Direct agency-id filter (the report references this agency). */
  targetAgencyId: z.string().trim().min(1).max(60).optional(),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  skip: z.coerce.number().int().min(0).default(0),
});
export type ListAbuseReportsInput = z.input<typeof listAbuseReportsInput>;

export async function listAbuseReports(
  ctx: SystemAdminContext,
  rawInput: Partial<ListAbuseReportsInput> = {},
): Promise<{ rows: AbuseReportRow[]; total: number }> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const input = listAbuseReportsInput.parse(rawInput);
  const where: Prisma.AbuseReportWhereInput = {};
  if (input.status) where.status = input.status;
  if (input.category) where.category = input.category;
  if (input.assignedToSystemAdminId) where.assignedToSystemAdminId = input.assignedToSystemAdminId;
  if (input.targetAgencyId) where.targetAgencyId = input.targetAgencyId;

  const [rawRows, total] = await Promise.all([
    prisma.abuseReport.findMany({
      where,
      orderBy: [
        // OPEN first, then by age. Same ordering the /root/quality queue uses.
        { status: "asc" },
        { createdAt: "asc" },
      ],
      take: input.take,
      skip: input.skip,
      select: {
        id: true,
        reportedByEmail: true,
        category: true,
        status: true,
        body: true,
        targetAgencyId: true,
        targetMemberId: true,
        targetOutputId: true,
        resolution: true,
        createdAt: true,
        resolvedAt: true,
        updatedAt: true,
        assignedTo: { select: { id: true, email: true, name: true } },
      },
    }),
    prisma.abuseReport.count({ where }),
  ]);

  const agencyIds = [
    ...new Set(rawRows.map((r) => r.targetAgencyId).filter((x): x is string => Boolean(x))),
  ];
  const agencyNameById = new Map<string, string>();
  if (agencyIds.length > 0) {
    const agencies = await prisma.agency.findMany({
      where: { id: { in: agencyIds } },
      select: { id: true, name: true },
    });
    for (const a of agencies) agencyNameById.set(a.id, a.name);
  }

  const rows: AbuseReportRow[] = rawRows.map((r) => ({
    id: r.id,
    reportedByEmail: r.reportedByEmail,
    category: r.category,
    status: r.status,
    body: r.body,
    targetAgencyId: r.targetAgencyId,
    targetAgencyName: r.targetAgencyId ? (agencyNameById.get(r.targetAgencyId) ?? null) : null,
    targetMemberId: r.targetMemberId,
    targetOutputId: r.targetOutputId,
    resolution: r.resolution,
    assignedTo: r.assignedTo,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    updatedAt: r.updatedAt,
  }));

  return { rows, total };
}

// ============================================================
// Abuse reports — writes
// ============================================================

export const createAbuseReportInput = z.object({
  reportedByEmail: z
    .string()
    .trim()
    .max(200)
    .email()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  category: z.enum(ABUSE_REPORT_CATEGORY_VALUES),
  body: z.string().trim().min(3).max(10_000),
  targetAgencyId: z.string().trim().max(60).optional(),
  targetMemberId: z.string().trim().max(60).optional(),
  targetOutputId: z.string().trim().max(60).optional(),
  /** Optional pre-assignment. Defaults to unassigned + OPEN. */
  assignedToSystemAdminId: z.string().trim().max(60).optional(),
  /** Free-text audit note for the ABUSE_ASSIGN row when pre-assigning. */
  note: z.string().trim().max(500).optional(),
});
export type CreateAbuseReportInput = z.input<typeof createAbuseReportInput>;

/**
 * Manual-entry path. The row lands OPEN by default; if `assignedToSystemAdminId`
 * is set, the row starts IN_REVIEW and an ABUSE_ASSIGN audit row fires
 * inside the same TX.
 */
export async function createAbuseReport(
  ctx: SystemAdminContext,
  rawInput: CreateAbuseReportInput,
): Promise<AbuseReportRow> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = createAbuseReportInput.parse(rawInput);

  const targetAgencyId = normalizeOptional(input.targetAgencyId);
  const targetMemberId = normalizeOptional(input.targetMemberId);
  const targetOutputId = normalizeOptional(input.targetOutputId);
  const assignedToSystemAdminId = normalizeOptional(input.assignedToSystemAdminId);

  return withSystemAudit(
    ctx,
    {
      // Every create audit-lands as ABUSE_ASSIGN — with or without a live
      // assignee. The `after` snapshot captures the assignee state so a
      // future filter on "created but never touched" reads it from there,
      // no dedicated `abuse.create` action key needed yet.
      action: SYSTEM_AUDIT_ACTIONS.ABUSE_ASSIGN,
      targetAgencyId: targetAgencyId ?? null,
      targetEntityType: "abuse_report",
      note: input.note ?? null,
    },
    async (tx, audit) => {
      const created = await tx.abuseReport.create({
        data: {
          reportedByEmail: input.reportedByEmail ?? null,
          category: input.category,
          body: input.body,
          status: assignedToSystemAdminId ? "IN_REVIEW" : "OPEN",
          targetAgencyId: targetAgencyId ?? null,
          targetMemberId: targetMemberId ?? null,
          targetOutputId: targetOutputId ?? null,
          assignedToSystemAdminId: assignedToSystemAdminId ?? null,
        },
        select: abuseReportSelect,
      });
      audit.setBefore(null);
      audit.setAfter(created);
      return toAbuseReportRow(created, null);
    },
  );
}

export const assignAbuseReportInput = z.object({
  id: z.string().trim().min(1),
  /** Set to null to un-assign (returns to OPEN). */
  assignedToSystemAdminId: z.string().trim().min(1).max(60).nullable(),
  note: z.string().trim().max(500).optional(),
});
export type AssignAbuseReportInput = z.input<typeof assignAbuseReportInput>;

export async function assignAbuseReport(
  ctx: SystemAdminContext,
  rawInput: AssignAbuseReportInput,
): Promise<AbuseReportRow> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = assignAbuseReportInput.parse(rawInput);

  // Look the row up outside the audit wrapper so `targetAgencyId` lands on
  // the audit entry — same pattern used by `revokeAgencyLimitOverride`.
  const existing = await prisma.abuseReport.findUnique({
    where: { id: input.id },
    select: { targetAgencyId: true },
  });
  if (!existing) throw new NotFoundError(`AbuseReport ${input.id} not found`);

  return withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.ABUSE_ASSIGN,
      targetAgencyId: existing.targetAgencyId,
      targetEntityType: "abuse_report",
      targetEntityId: input.id,
      note: input.note ?? null,
    },
    async (tx, audit) => {
      const before = await tx.abuseReport.findUnique({
        where: { id: input.id },
        select: abuseReportSelect,
      });
      if (!before) throw new NotFoundError(`AbuseReport ${input.id} not found`);
      audit.setBefore(before);

      const after = await tx.abuseReport.update({
        where: { id: input.id },
        data: {
          assignedToSystemAdminId: input.assignedToSystemAdminId,
          // Assigning nudges the row into review; un-assigning drops it back
          // to OPEN so it re-enters the untouched queue. Terminal states
          // (RESOLVED / DISMISSED) don't flip back — the resolve/dismiss
          // paths own those transitions.
          status:
            before.status === "RESOLVED" || before.status === "DISMISSED"
              ? before.status
              : input.assignedToSystemAdminId === null
                ? "OPEN"
                : "IN_REVIEW",
        },
        select: abuseReportSelect,
      });
      audit.setAfter(after);
      return toAbuseReportRow(after, null);
    },
  );
}

export const resolveAbuseReportInput = z.object({
  id: z.string().trim().min(1),
  /** Required — what action was taken on the report. */
  resolution: z.string().trim().min(3).max(2_000),
  /** Audit note; distinct from `resolution` (which lives on the row). */
  note: z.string().trim().max(500).optional(),
});
export type ResolveAbuseReportInput = z.input<typeof resolveAbuseReportInput>;

export async function resolveAbuseReport(
  ctx: SystemAdminContext,
  rawInput: ResolveAbuseReportInput,
): Promise<AbuseReportRow> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = resolveAbuseReportInput.parse(rawInput);

  const existing = await prisma.abuseReport.findUnique({
    where: { id: input.id },
    select: { targetAgencyId: true },
  });
  if (!existing) throw new NotFoundError(`AbuseReport ${input.id} not found`);

  return withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.ABUSE_RESOLVE,
      targetAgencyId: existing.targetAgencyId,
      targetEntityType: "abuse_report",
      targetEntityId: input.id,
      note: input.note ?? null,
    },
    async (tx, audit) => {
      const before = await tx.abuseReport.findUnique({
        where: { id: input.id },
        select: abuseReportSelect,
      });
      if (!before) throw new NotFoundError(`AbuseReport ${input.id} not found`);
      audit.setBefore(before);

      const after = await tx.abuseReport.update({
        where: { id: input.id },
        data: {
          status: "RESOLVED",
          resolution: input.resolution,
          resolvedAt: new Date(),
          // If nobody was assigned, stamp the resolver as the assignee so the
          // "who acted on this" audit chain is intact.
          assignedToSystemAdminId: before.assignedTo?.id ?? ctx.admin.id,
        },
        select: abuseReportSelect,
      });
      audit.setAfter(after);
      return toAbuseReportRow(after, null);
    },
  );
}

export const dismissAbuseReportInput = z.object({
  id: z.string().trim().min(1),
  /** Required — why the report is being dismissed with no action. */
  note: z.string().trim().min(3).max(500),
});
export type DismissAbuseReportInput = z.input<typeof dismissAbuseReportInput>;

export async function dismissAbuseReport(
  ctx: SystemAdminContext,
  rawInput: DismissAbuseReportInput,
): Promise<AbuseReportRow> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = dismissAbuseReportInput.parse(rawInput);

  const existing = await prisma.abuseReport.findUnique({
    where: { id: input.id },
    select: { targetAgencyId: true },
  });
  if (!existing) throw new NotFoundError(`AbuseReport ${input.id} not found`);

  return withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.ABUSE_DISMISS,
      targetAgencyId: existing.targetAgencyId,
      targetEntityType: "abuse_report",
      targetEntityId: input.id,
      note: input.note,
    },
    async (tx, audit) => {
      const before = await tx.abuseReport.findUnique({
        where: { id: input.id },
        select: abuseReportSelect,
      });
      if (!before) throw new NotFoundError(`AbuseReport ${input.id} not found`);
      audit.setBefore(before);

      const after = await tx.abuseReport.update({
        where: { id: input.id },
        data: {
          status: "DISMISSED",
          resolvedAt: new Date(),
          assignedToSystemAdminId: before.assignedTo?.id ?? ctx.admin.id,
        },
        select: abuseReportSelect,
      });
      audit.setAfter(after);
      return toAbuseReportRow(after, null);
    },
  );
}

// ============================================================
// Flagged outputs — reads + writes
// ============================================================

export type FlaggedOutputRow = {
  id: string;
  episodeId: string;
  episodeTitle: string;
  platform: Platform;
  version: number;
  content: string;
  flagReason: string;
  flaggedAt: Date;
  flaggedByMemberId: string | null;
  agencyId: string;
  agencyName: string;
  /** True if this row is the current version (`supersededAt IS NULL`). */
  isCurrent: boolean;
};

export const listFlaggedOutputsInput = z.object({
  /** Restrict to a specific agency. */
  agencyId: z.string().trim().min(1).max(60).optional(),
  /** Show only rows that are still the current version (default true). */
  currentOnly: z.boolean().default(true),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  skip: z.coerce.number().int().min(0).default(0),
});
export type ListFlaggedOutputsInput = z.input<typeof listFlaggedOutputsInput>;

export async function listFlaggedOutputs(
  ctx: SystemAdminContext,
  rawInput: Partial<ListFlaggedOutputsInput> = {},
): Promise<{ rows: FlaggedOutputRow[]; total: number }> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const input = listFlaggedOutputsInput.parse(rawInput);
  const where: Prisma.GeneratedOutputWhereInput = { flaggedAt: { not: null } };
  if (input.currentOnly) where.supersededAt = null;
  if (input.agencyId) {
    where.episode = { show: { client: { agencyId: input.agencyId } } };
  }

  const [rows, total] = await Promise.all([
    prisma.generatedOutput.findMany({
      where,
      orderBy: { flaggedAt: "desc" },
      take: input.take,
      skip: input.skip,
      select: {
        id: true,
        episodeId: true,
        platform: true,
        version: true,
        content: true,
        flagReason: true,
        flaggedAt: true,
        flaggedByMemberId: true,
        supersededAt: true,
        episode: {
          select: {
            title: true,
            show: {
              select: {
                client: { select: { agencyId: true, agency: { select: { name: true } } } },
              },
            },
          },
        },
      },
    }),
    prisma.generatedOutput.count({ where }),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      episodeId: r.episodeId,
      episodeTitle: r.episode.title,
      platform: r.platform,
      version: r.version,
      content: r.content,
      flagReason: r.flagReason ?? "",
      flaggedAt: r.flaggedAt ?? new Date(0),
      flaggedByMemberId: r.flaggedByMemberId,
      agencyId: r.episode.show.client.agencyId,
      agencyName: r.episode.show.client.agency.name,
      isCurrent: r.supersededAt === null,
    })),
    total,
  };
}

export const flagOutputInput = z.object({
  outputId: z.string().trim().min(1),
  reason: z.string().trim().min(3).max(500),
});
export type FlagOutputInput = z.input<typeof flagOutputInput>;

export async function flagOutput(
  ctx: SystemAdminContext,
  rawInput: FlagOutputInput,
): Promise<void> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = flagOutputInput.parse(rawInput);

  // Resolve the agencyId via the join so the audit row is scoped correctly.
  const existing = await prisma.generatedOutput.findUnique({
    where: { id: input.outputId },
    select: {
      episode: {
        select: {
          show: { select: { client: { select: { agencyId: true } } } },
        },
      },
    },
  });
  if (!existing) throw new NotFoundError(`GeneratedOutput ${input.outputId} not found`);

  await withSystemAudit(
    ctx,
    {
      // Reuse the ABUSE_ASSIGN key — moderation flags land on the same audit
      // subject. We don't need a dedicated `output.flag` action key yet; if
      // volume grows we add one and backfill.
      action: SYSTEM_AUDIT_ACTIONS.ABUSE_ASSIGN,
      targetAgencyId: existing.episode.show.client.agencyId,
      targetEntityType: "generated_output_flag",
      targetEntityId: input.outputId,
    },
    async (tx, audit) => {
      const before = await tx.generatedOutput.findUnique({
        where: { id: input.outputId },
        select: { flagReason: true, flaggedByMemberId: true, flaggedAt: true },
      });
      audit.setBefore(before);
      const after = await tx.generatedOutput.update({
        where: { id: input.outputId },
        data: {
          flagReason: input.reason,
          flaggedByMemberId: null, // ROOT-initiated — no Member on the other side
          flaggedAt: new Date(),
        },
        select: { flagReason: true, flaggedByMemberId: true, flaggedAt: true },
      });
      audit.setAfter(after);
    },
  );
}

export const unflagOutputInput = z.object({
  outputId: z.string().trim().min(1),
  note: z.string().trim().min(3).max(500),
});
export type UnflagOutputInput = z.input<typeof unflagOutputInput>;

export async function unflagOutput(
  ctx: SystemAdminContext,
  rawInput: UnflagOutputInput,
): Promise<void> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);
  const input = unflagOutputInput.parse(rawInput);

  const existing = await prisma.generatedOutput.findUnique({
    where: { id: input.outputId },
    select: {
      flaggedAt: true,
      episode: { select: { show: { select: { client: { select: { agencyId: true } } } } } },
    },
  });
  if (!existing) throw new NotFoundError(`GeneratedOutput ${input.outputId} not found`);
  if (existing.flaggedAt === null) return; // idempotent — already unflagged

  await withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.ABUSE_DISMISS,
      targetAgencyId: existing.episode.show.client.agencyId,
      targetEntityType: "generated_output_flag",
      targetEntityId: input.outputId,
      note: input.note,
    },
    async (tx, audit) => {
      const before = await tx.generatedOutput.findUnique({
        where: { id: input.outputId },
        select: { flagReason: true, flaggedByMemberId: true, flaggedAt: true },
      });
      audit.setBefore(before);
      const after = await tx.generatedOutput.update({
        where: { id: input.outputId },
        data: { flagReason: null, flaggedByMemberId: null, flaggedAt: null },
        select: { flagReason: true, flaggedByMemberId: true, flaggedAt: true },
      });
      audit.setAfter(after);
    },
  );
}

// ============================================================
// Helpers
// ============================================================

const abuseReportSelect = {
  id: true,
  reportedByEmail: true,
  category: true,
  status: true,
  body: true,
  targetAgencyId: true,
  targetMemberId: true,
  targetOutputId: true,
  resolution: true,
  createdAt: true,
  resolvedAt: true,
  updatedAt: true,
  assignedTo: { select: { id: true, email: true, name: true } },
} satisfies Prisma.AbuseReportSelect;

type RawAbuseReport = Prisma.AbuseReportGetPayload<{ select: typeof abuseReportSelect }>;

function toAbuseReportRow(r: RawAbuseReport, agencyName: string | null): AbuseReportRow {
  return {
    id: r.id,
    reportedByEmail: r.reportedByEmail,
    category: r.category,
    status: r.status,
    body: r.body,
    targetAgencyId: r.targetAgencyId,
    targetAgencyName: agencyName,
    targetMemberId: r.targetMemberId,
    targetOutputId: r.targetOutputId,
    resolution: r.resolution,
    assignedTo: r.assignedTo,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    updatedAt: r.updatedAt,
  };
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export const ABUSE_REPORT_STATUS_OPTIONS: readonly AbuseReportStatus[] = ABUSE_REPORT_STATUS_VALUES;
export const ABUSE_REPORT_CATEGORY_OPTIONS: readonly AbuseReportCategory[] =
  ABUSE_REPORT_CATEGORY_VALUES;
