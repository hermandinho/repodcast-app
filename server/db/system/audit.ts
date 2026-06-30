import "server-only";

// `Prisma` is imported as both a runtime value (for `Prisma.JsonNull` /
// `Prisma.TransactionClient` typing) and a namespace — a single non-type
// import covers both.
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { SystemAdminContext } from "@/server/auth/system";
import type { SystemAuditAction } from "./audit-actions";

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
