import "server-only";

// `Prisma` is imported as both a runtime value (for `Prisma.JsonNull` /
// `Prisma.TransactionClient` typing) and a namespace — a single non-type
// import covers both.
import { Prisma, type SystemAdminRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { assertSystemRole, SYSTEM_READ_ROLES, type SystemAdminContext } from "@/server/auth/system";
import { SYSTEM_AUDIT_ACTIONS, type SystemAuditAction } from "./audit-actions";

/**
 * Shape of the audit row produced by `withSystemAudit`. Snapshots are stored
 * as Json so we can capture arbitrarily-shaped pre/post images without ever
 * adding a column.
 */
export type SystemAuditInput = {
  action: SystemAuditAction;
  targetAgencyId?: string | null;
  targetMemberId?: string | null;
  targetEntityType?: string | null;
  targetEntityId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  /** Free-text reason — required by action-layer guards for destructive ops. */
  note?: string | null;
  /** Source IP. Trimmed to first non-trusted-proxy hop at the action layer. */
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Wrap a platform-admin mutation in a single `prisma.$transaction` that
 * ALSO writes a `SystemAuditLog` row. If either side throws, both roll back —
 * there is no "mutation succeeded but audit failed" path.
 *
 * The callback receives the transaction client AND a `recordAfter(json)`
 * helper. The audit row is inserted at the END of the TX, so the callback
 * can refine the `after` snapshot based on its own write result (e.g. the
 * post-update row).
 *
 * Usage:
 *
 *   await withSystemAudit(ctx, { action: "agency.suspend", targetAgencyId: id }, async (tx, audit) => {
 *     const before = await tx.agency.findUnique({ where: { id } });
 *     audit.setBefore(before);
 *     const after = await tx.agency.update({ where: { id }, data: { suspendedAt: new Date() } });
 *     audit.setAfter(after);
 *     return after;
 *   });
 */
export async function withSystemAudit<T>(
  ctx: SystemAdminContext,
  input: SystemAuditInput,
  fn: (tx: Prisma.TransactionClient, audit: MutableAuditSnapshot) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const snapshot: MutableAuditSnapshot = {
      before: input.before ?? null,
      after: input.after ?? null,
      note: input.note ?? null,
      setBefore(value) {
        this.before = toJsonValue(value);
      },
      setAfter(value) {
        this.after = toJsonValue(value);
      },
      setNote(value) {
        this.note = value ?? null;
      },
    };

    const result = await fn(tx, snapshot);

    await tx.systemAuditLog.create({
      data: {
        bySystemAdminId: ctx.admin.id,
        action: input.action,
        targetAgencyId: input.targetAgencyId ?? null,
        targetMemberId: input.targetMemberId ?? null,
        targetEntityType: input.targetEntityType ?? null,
        targetEntityId: input.targetEntityId ?? null,
        before: snapshot.before ?? Prisma.JsonNull,
        after: snapshot.after ?? Prisma.JsonNull,
        note: snapshot.note,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    });

    return result;
  });
}

/** Coerce arbitrary Prisma row / null / unknown into `Prisma.InputJsonValue | null`. */
function toJsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export type MutableAuditSnapshot = {
  before: Prisma.InputJsonValue | null;
  after: Prisma.InputJsonValue | null;
  note: string | null;
  setBefore(value: unknown): void;
  setAfter(value: unknown): void;
  setNote(value: string | null | undefined): void;
};

// ============================================================
// Read helpers — the `/root/audit` viewer
// ============================================================
//
// The audit log is append-only and constitutional: no soft-delete, no
// editing, no way to hide entries even from the ROOT user themself. These
// helpers are open to every system read role (ANALYST → ROOT); a SUPPORT or
// ANALYST needs to see what a ROOT did.

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;

/** Every audit-action key we know about. Drives the filter dropdown. */
const SYSTEM_AUDIT_ACTION_VALUES = Object.values(SYSTEM_AUDIT_ACTIONS) as [
  SystemAuditAction,
  ...SystemAuditAction[],
];

export const listSystemAuditEntriesInput = z.object({
  /** SystemAdmin.id — filter to actions by this specific admin. */
  bySystemAdminId: z.string().trim().min(1).max(60).optional(),
  /** Dotted action key from `SYSTEM_AUDIT_ACTIONS`. */
  action: z.enum(SYSTEM_AUDIT_ACTION_VALUES).optional(),
  /** Direct agency-id filter — pins the query to `targetAgencyId = ?`. */
  targetAgencyId: z.string().trim().min(1).max(60).optional(),
  /**
   * Agency-name substring (case-insensitive). Resolves to the set of
   * matching agencyIds before hitting `systemAuditLog`, then filters via
   * `targetAgencyId IN (...)`. Empty match set → zero rows.
   */
  agencySearch: z.string().trim().min(1).max(120).optional(),
  /** Created-after lower bound (inclusive). */
  createdFrom: z.coerce.date().optional(),
  /** Created-before upper bound (inclusive, widened to end-of-day). */
  createdTo: z.coerce.date().optional(),
  take: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  skip: z.coerce.number().int().min(0).default(0),
});
export type ListSystemAuditEntriesInput = z.input<typeof listSystemAuditEntriesInput>;
type ParsedListSystemAuditEntriesInput = z.output<typeof listSystemAuditEntriesInput>;

export type SystemAuditRowForRoot = {
  id: string;
  action: string;
  createdAt: Date;
  note: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  targetMemberId: string | null;
  targetEntityType: string | null;
  targetEntityId: string | null;
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
  admin: {
    id: string;
    email: string;
    name: string | null;
    role: SystemAdminRole;
  };
  targetAgency: { id: string; name: string } | null;
};

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

/**
 * Build the `systemAuditLog.where` clause from parsed filters. Returns a
 * `null` sentinel when the agency-name search resolves to zero agencies —
 * the caller uses that to short-circuit to an empty result set (a
 * `targetAgencyId: { in: [] }` where would also work but Prisma raises
 * warnings on empty `in` arrays).
 */
async function buildAuditWhere(
  input: ParsedListSystemAuditEntriesInput,
): Promise<Prisma.SystemAuditLogWhereInput | null> {
  const where: Prisma.SystemAuditLogWhereInput = {};

  if (input.bySystemAdminId) {
    where.bySystemAdminId = input.bySystemAdminId;
  }
  if (input.action) {
    where.action = input.action;
  }

  // Direct + name-search compose with AND: if both are set the name search
  // must include the direct id, otherwise zero rows. In practice the UI
  // exposes one or the other but the shape stays sound either way.
  const agencyIdSet = new Set<string>();
  let agencyFilterActive = false;

  if (input.targetAgencyId) {
    agencyIdSet.add(input.targetAgencyId);
    agencyFilterActive = true;
  }

  if (input.agencySearch) {
    const matches = await prisma.agency.findMany({
      where: { name: { contains: input.agencySearch, mode: "insensitive" } },
      select: { id: true },
      // Bounded — the audit page is not a discovery surface for agencies;
      // if the search is that ambiguous the operator should tighten it.
      take: 500,
    });
    if (matches.length === 0) return null;
    if (agencyFilterActive) {
      // Intersect the direct id with the name search.
      for (const id of [...agencyIdSet]) {
        if (!matches.some((m) => m.id === id)) agencyIdSet.delete(id);
      }
      if (agencyIdSet.size === 0) return null;
    } else {
      for (const m of matches) agencyIdSet.add(m.id);
    }
    agencyFilterActive = true;
  }

  if (agencyFilterActive) {
    where.targetAgencyId = agencyIdSet.size === 1 ? [...agencyIdSet][0] : { in: [...agencyIdSet] };
  }

  if (input.createdFrom || input.createdTo) {
    where.createdAt = {};
    if (input.createdFrom) where.createdAt.gte = input.createdFrom;
    if (input.createdTo) where.createdAt.lte = endOfDay(input.createdTo);
  }

  return where;
}

/**
 * Paginated audit-log query. Read-open to every system role — a SUPPORT or
 * ANALYST needs to be able to see what a ROOT did. Rows come back sorted by
 * `createdAt DESC` (matching the index in `prisma/schema.prisma`).
 *
 * `targetAgencyId` on `SystemAuditLog` is a raw String column (no FK to
 * `Agency`) so a hard-deleted agency doesn't drop its audit history. That
 * means we resolve agency names via a second query rather than an include —
 * a row whose target agency has been deleted comes back with `targetAgency:
 * null`, which the UI renders as `agency <id>… (deleted)`.
 */
export async function listSystemAuditEntries(
  ctx: SystemAdminContext,
  rawInput: Partial<ListSystemAuditEntriesInput> = {},
): Promise<{ rows: SystemAuditRowForRoot[]; total: number }> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const input = listSystemAuditEntriesInput.parse(rawInput);
  const where = await buildAuditWhere(input);
  if (where === null) return { rows: [], total: 0 };

  const [rawRows, total] = await Promise.all([
    prisma.systemAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: input.take,
      skip: input.skip,
      select: {
        id: true,
        action: true,
        createdAt: true,
        note: true,
        ipAddress: true,
        userAgent: true,
        targetAgencyId: true,
        targetMemberId: true,
        targetEntityType: true,
        targetEntityId: true,
        before: true,
        after: true,
        bySystemAdmin: {
          select: { id: true, email: true, name: true, role: true },
        },
      },
    }),
    prisma.systemAuditLog.count({ where }),
  ]);

  // Batch-resolve the agency names for whichever ids appeared on the page.
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

  const rows: SystemAuditRowForRoot[] = rawRows.map((r) => ({
    id: r.id,
    action: r.action,
    createdAt: r.createdAt,
    note: r.note,
    ipAddress: r.ipAddress,
    userAgent: r.userAgent,
    targetMemberId: r.targetMemberId,
    targetEntityType: r.targetEntityType,
    targetEntityId: r.targetEntityId,
    before: r.before ?? null,
    after: r.after ?? null,
    admin: {
      id: r.bySystemAdmin.id,
      email: r.bySystemAdmin.email,
      name: r.bySystemAdmin.name,
      role: r.bySystemAdmin.role,
    },
    targetAgency: r.targetAgencyId
      ? { id: r.targetAgencyId, name: agencyNameById.get(r.targetAgencyId) ?? "" }
      : null,
  }));

  return { rows, total };
}

/**
 * Non-deactivated system admins, ordered by role rank then email. Powers the
 * "filter by admin" dropdown on `/root/audit`. Deactivated admins still
 * appear in historical rows via the eager join, but they don't need to
 * clutter the filter picker.
 */
export type SystemAdminOption = {
  id: string;
  email: string;
  name: string | null;
  role: SystemAdminRole;
};

export async function listActiveSystemAdmins(
  ctx: SystemAdminContext,
): Promise<SystemAdminOption[]> {
  assertSystemRole(ctx, SYSTEM_READ_ROLES);

  const rows = await prisma.systemAdmin.findMany({
    where: { deactivatedAt: null },
    select: { id: true, email: true, name: true, role: true },
  });

  const ROLE_RANK: Record<SystemAdminRole, number> = {
    ROOT: 0,
    OPERATOR: 1,
    SUPPORT: 2,
    ANALYST: 3,
  };

  return [...rows].sort((a, b) => {
    const r = ROLE_RANK[a.role] - ROLE_RANK[b.role];
    if (r !== 0) return r;
    return a.email.localeCompare(b.email);
  });
}

/** The canonical filter-dropdown value set for `SystemAuditLog.action`. */
export const SYSTEM_AUDIT_ACTION_OPTIONS: readonly SystemAuditAction[] = SYSTEM_AUDIT_ACTION_VALUES;
