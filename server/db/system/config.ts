import "server-only";

import { LimitOverrideResource, type Prisma } from "@prisma/client";
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
 * Phase 3.6.11 — platform configuration + per-agency limit overrides.
 *
 * Two orthogonal surfaces sharing one file (they read from the same admin
 * page and audit through the same wrapper):
 *
 *   - `SystemConfig` — flat key/value bag. Anything that would otherwise
 *     require a schema migration lives here (feature flags not surfaced
 *     through PostHog, Anthropic model defaults, per-plan cost caps, the CAC
 *     entry for LTV:CAC, marketing copy). `value` is Json so the SHAPE can
 *     change without a migration.
 *   - `AgencyLimitOverride` — per-agency resource ceiling that trumps the
 *     plan default. Consumed by `planCapacity()` in `server/billing/limits.ts`.
 *
 * Role posture:
 *   - Reads open to every system role (`SYSTEM_READ_ROLES`).
 *   - Writes gated to `SYSTEM_WRITE_ROLES` (ROOT + OPERATOR). SUPPORT and
 *     ANALYST can inspect the current state but not mutate. Every write is
 *     wrapped in `withSystemAudit` — a mutation without a matching audit row
 *     is architecturally impossible.
 */

// ============================================================
// Resource enum <-> LimitedResource string mapping
// ============================================================
//
// `LimitedResource` in `server/billing/limits.ts` is a lowercase string
// union that predates this table. `LimitOverrideResource` in the schema is
// the SCREAMING_SNAKE Prisma enum. This adapter is the single conversion
// point — if you add a resource, update both sides and this map.

export const LIMIT_OVERRIDE_RESOURCE_TO_LIMITED: Record<
  LimitOverrideResource,
  "shows" | "members" | "episodes" | "generations"
> = {
  SHOWS: "shows",
  MEMBERS: "members",
  EPISODES: "episodes",
  GENERATIONS: "generations",
};

export const LIMITED_TO_LIMIT_OVERRIDE_RESOURCE: Record<
  "shows" | "members" | "episodes" | "generations",
  LimitOverrideResource
> = {
  shows: "SHOWS",
  members: "MEMBERS",
  episodes: "EPISODES",
  generations: "GENERATIONS",
};

// ============================================================
// SystemConfig — reads
// ============================================================

export type SystemConfigRow = {
  id: string;
  key: string;
  value: Prisma.JsonValue;
  description: string | null;
  updatedAt: Date;
  updatedBy: { id: string; email: string; name: string | null } | null;
};

export async function listSystemConfig(ctx: SystemAdminContext): Promise<SystemConfigRow[]> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const rows = await prisma.systemConfig.findMany({
    orderBy: { key: "asc" },
    select: {
      id: true,
      key: true,
      value: true,
      description: true,
      updatedAt: true,
      updatedBy: { select: { id: true, email: true, name: true } },
    },
  });
  return rows.map(toSystemConfigRow);
}

/**
 * Non-throwing lookup for consumption paths. Returns null when the key
 * doesn't exist so the caller can supply a default without a try/catch.
 */
export async function getSystemConfigValue(key: string): Promise<Prisma.JsonValue | null> {
  const row = await prisma.systemConfig.findUnique({
    where: { key },
    select: { value: true },
  });
  return row?.value ?? null;
}

function toSystemConfigRow(r: {
  id: string;
  key: string;
  value: Prisma.JsonValue;
  description: string | null;
  updatedAt: Date;
  updatedBy: { id: string; email: string; name: string | null } | null;
}): SystemConfigRow {
  return {
    id: r.id,
    key: r.key,
    value: r.value,
    description: r.description,
    updatedAt: r.updatedAt,
    updatedBy: r.updatedBy,
  };
}

// ============================================================
// SystemConfig — writes
// ============================================================

/**
 * The `key` grammar is deliberately narrow: uppercase A-Z, digits, and
 * underscores, minimum 2 characters. Prevents typos landing in the DB as
 * new keys (`Rss_Import` vs `RSS_IMPORT` would silently split).
 */
const SYSTEM_CONFIG_KEY_RE = /^[A-Z0-9_]{2,64}$/;

export const upsertSystemConfigInput = z.object({
  key: z
    .string()
    .trim()
    .regex(SYSTEM_CONFIG_KEY_RE, "key must be UPPER_SNAKE_CASE (A-Z, 0-9, _), 2-64 chars"),
  /** Raw JSON string as typed by the operator; we parse + validate here. */
  valueJson: z.string().trim().min(1).max(20_000),
  description: z.string().trim().max(500).optional(),
  /** Free-text reason recorded on the audit row. Required for destructive ops
   *  by convention — the UI enforces it there, but plain edits leave it optional. */
  note: z.string().trim().max(500).optional(),
});
export type UpsertSystemConfigInput = z.infer<typeof upsertSystemConfigInput>;

export async function upsertSystemConfig(
  ctx: SystemAdminContext,
  rawInput: UpsertSystemConfigInput,
): Promise<SystemConfigRow> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);

  const input = upsertSystemConfigInput.parse(rawInput);
  const parsedValue = parseJsonValue(input.valueJson);

  return withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.CONFIG_UPDATE,
      targetEntityType: "system_config",
      targetEntityId: input.key,
      note: input.note ?? null,
    },
    async (tx, audit) => {
      const before = await tx.systemConfig.findUnique({
        where: { key: input.key },
        select: {
          id: true,
          key: true,
          value: true,
          description: true,
          updatedAt: true,
          updatedBy: { select: { id: true, email: true, name: true } },
        },
      });
      audit.setBefore(before);

      const after = await tx.systemConfig.upsert({
        where: { key: input.key },
        create: {
          key: input.key,
          value: parsedValue,
          description: input.description ?? null,
          updatedBySystemAdminId: ctx.admin.id,
        },
        update: {
          value: parsedValue,
          description: input.description ?? null,
          updatedBySystemAdminId: ctx.admin.id,
        },
        select: {
          id: true,
          key: true,
          value: true,
          description: true,
          updatedAt: true,
          updatedBy: { select: { id: true, email: true, name: true } },
        },
      });
      audit.setAfter(after);
      return toSystemConfigRow(after);
    },
  );
}

export const deleteSystemConfigInput = z.object({
  key: z.string().trim().min(1),
  /** Required — audit note explaining WHY the key is being retired. */
  note: z.string().trim().min(3).max(500),
});
export type DeleteSystemConfigInput = z.infer<typeof deleteSystemConfigInput>;

export async function deleteSystemConfig(
  ctx: SystemAdminContext,
  rawInput: DeleteSystemConfigInput,
): Promise<void> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);

  const input = deleteSystemConfigInput.parse(rawInput);
  await withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.CONFIG_UPDATE,
      targetEntityType: "system_config",
      targetEntityId: input.key,
      note: input.note,
    },
    async (tx, audit) => {
      const before = await tx.systemConfig.findUnique({ where: { key: input.key } });
      if (!before) throw new NotFoundError(`SystemConfig key ${input.key} not found`);
      audit.setBefore(before);
      audit.setAfter(null);
      await tx.systemConfig.delete({ where: { key: input.key } });
    },
  );
}

function parseJsonValue(raw: string): Prisma.InputJsonValue {
  try {
    const parsed = JSON.parse(raw) as unknown;
    // `undefined` isn't legal JSON; JSON.parse never returns it, so this
    // cast is safe once we've confirmed the text parsed cleanly.
    return parsed as Prisma.InputJsonValue;
  } catch (err) {
    throw new ValidationError(
      `value is not valid JSON: ${err instanceof Error ? err.message : "parse error"}`,
    );
  }
}

// ============================================================
// AgencyLimitOverride — reads
// ============================================================

export type AgencyLimitOverrideRow = {
  id: string;
  agencyId: string;
  agencyName: string;
  resource: LimitOverrideResource;
  value: number;
  expiresAt: Date | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
  by: { id: string; email: string; name: string | null };
  /** Server-computed convenience: true if the override is currently applied. */
  isActive: boolean;
};

export const listAgencyLimitOverridesInput = z.object({
  agencyId: z.string().trim().min(1).optional(),
  /** Filter to only overrides currently in effect. */
  activeOnly: z.boolean().optional(),
});
export type ListAgencyLimitOverridesInput = z.infer<typeof listAgencyLimitOverridesInput>;

export async function listAgencyLimitOverrides(
  ctx: SystemAdminContext,
  rawInput: Partial<ListAgencyLimitOverridesInput> = {},
): Promise<AgencyLimitOverrideRow[]> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const input = listAgencyLimitOverridesInput.parse(rawInput);
  const where: Prisma.AgencyLimitOverrideWhereInput = {};
  if (input.agencyId) where.agencyId = input.agencyId;
  if (input.activeOnly) {
    where.OR = [{ expiresAt: null }, { expiresAt: { gt: new Date() } }];
  }

  const rows = await prisma.agencyLimitOverride.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      agencyId: true,
      resource: true,
      value: true,
      expiresAt: true,
      note: true,
      createdAt: true,
      updatedAt: true,
      agency: { select: { name: true } },
      by: { select: { id: true, email: true, name: true } },
    },
  });

  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    agencyId: r.agencyId,
    agencyName: r.agency.name,
    resource: r.resource,
    value: r.value,
    expiresAt: r.expiresAt,
    note: r.note,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    by: r.by,
    isActive: r.expiresAt === null || r.expiresAt.getTime() > now,
  }));
}

/**
 * Consumption helper for `planCapacity()`. Returns the effective override
 * `value` if a live (unexpired) row exists for (agencyId, resource), else
 * `null`. Runs OUTSIDE the ROOT audit trail — this is a hot-path read from
 * tenant code, no system context available.
 */
export async function getEffectiveLimitOverride(
  agencyId: string,
  resource: LimitOverrideResource,
): Promise<number | null> {
  const row = await prisma.agencyLimitOverride.findUnique({
    where: { agencyId_resource: { agencyId, resource } },
    select: { value: true, expiresAt: true },
  });
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  return row.value;
}

// ============================================================
// AgencyLimitOverride — writes
// ============================================================

export const upsertAgencyLimitOverrideInput = z.object({
  agencyId: z.string().trim().min(1),
  resource: z.enum(["SHOWS", "MEMBERS", "EPISODES", "GENERATIONS"]),
  /** Absolute cap. 0 = fully disable the resource. Rejects negative values. */
  value: z.coerce.number().int().min(0).max(1_000_000),
  /** ISO date/datetime; null / undefined = indefinite. */
  expiresAt: z.coerce.date().optional(),
  note: z.string().trim().max(500).optional(),
});
export type UpsertAgencyLimitOverrideInput = z.infer<typeof upsertAgencyLimitOverrideInput>;

export async function upsertAgencyLimitOverride(
  ctx: SystemAdminContext,
  rawInput: UpsertAgencyLimitOverrideInput,
): Promise<AgencyLimitOverrideRow> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);

  const input = upsertAgencyLimitOverrideInput.parse(rawInput);

  return withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.CONFIG_AGENCY_LIMIT_OVERRIDE,
      targetAgencyId: input.agencyId,
      targetEntityType: "agency_limit_override",
      targetEntityId: `${input.agencyId}:${input.resource}`,
      note: input.note ?? null,
    },
    async (tx, audit) => {
      const before = await tx.agencyLimitOverride.findUnique({
        where: { agencyId_resource: { agencyId: input.agencyId, resource: input.resource } },
      });
      audit.setBefore(before);

      const after = await tx.agencyLimitOverride.upsert({
        where: { agencyId_resource: { agencyId: input.agencyId, resource: input.resource } },
        create: {
          agencyId: input.agencyId,
          resource: input.resource,
          value: input.value,
          expiresAt: input.expiresAt ?? null,
          note: input.note ?? null,
          bySystemAdminId: ctx.admin.id,
        },
        update: {
          value: input.value,
          expiresAt: input.expiresAt ?? null,
          note: input.note ?? null,
          bySystemAdminId: ctx.admin.id,
        },
        select: {
          id: true,
          agencyId: true,
          resource: true,
          value: true,
          expiresAt: true,
          note: true,
          createdAt: true,
          updatedAt: true,
          agency: { select: { name: true } },
          by: { select: { id: true, email: true, name: true } },
        },
      });
      audit.setAfter(after);

      return {
        id: after.id,
        agencyId: after.agencyId,
        agencyName: after.agency.name,
        resource: after.resource,
        value: after.value,
        expiresAt: after.expiresAt,
        note: after.note,
        createdAt: after.createdAt,
        updatedAt: after.updatedAt,
        by: after.by,
        isActive: after.expiresAt === null || after.expiresAt.getTime() > Date.now(),
      };
    },
  );
}

export const revokeAgencyLimitOverrideInput = z.object({
  id: z.string().trim().min(1),
  /** Required — audit note explaining WHY the override is being revoked. */
  note: z.string().trim().min(3).max(500),
});
export type RevokeAgencyLimitOverrideInput = z.infer<typeof revokeAgencyLimitOverrideInput>;

export async function revokeAgencyLimitOverride(
  ctx: SystemAdminContext,
  rawInput: RevokeAgencyLimitOverrideInput,
): Promise<void> {
  assertSystemRole(ctx, SYSTEM_WRITE_ROLES);

  const input = revokeAgencyLimitOverrideInput.parse(rawInput);

  // Look the override up BEFORE opening the audit wrapper so the audit row
  // can carry `targetAgencyId` — that's what the agency-scoped audit index
  // pivots on.
  const existing = await prisma.agencyLimitOverride.findUnique({
    where: { id: input.id },
    select: { agencyId: true },
  });
  if (!existing) throw new NotFoundError(`AgencyLimitOverride ${input.id} not found`);

  await withSystemAudit(
    ctx,
    {
      action: SYSTEM_AUDIT_ACTIONS.CONFIG_AGENCY_LIMIT_OVERRIDE,
      targetAgencyId: existing.agencyId,
      targetEntityType: "agency_limit_override",
      targetEntityId: input.id,
      note: input.note,
    },
    async (tx, audit) => {
      const before = await tx.agencyLimitOverride.findUnique({ where: { id: input.id } });
      if (!before) throw new NotFoundError(`AgencyLimitOverride ${input.id} not found`);
      audit.setBefore(before);
      audit.setAfter(null);
      await tx.agencyLimitOverride.delete({ where: { id: input.id } });
    },
  );
}
