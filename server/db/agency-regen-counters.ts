import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "./client";

/**
 * PricingV2 — per-agency, per-month counter for regeneration budgets.
 *
 * A "regeneration" is a re-render of a clip, artwork set, or audiogram.
 * First render for each entity is free (bundled with the initial
 * generate action); every re-run counts. Counters increment atomically
 * inside the action right after the capacity check so simultaneous
 * requests can't blow past the cap.
 */

export type RegenKind = "clip" | "artwork" | "audiogram";

const KIND_TO_COLUMN: Record<RegenKind, "clipRegens" | "artworkRegens" | "audiogramRegens"> = {
  clip: "clipRegens",
  artwork: "artworkRegens",
  audiogram: "audiogramRegens",
};

/** Current-month YYYY-MM string in UTC. Rollover happens at UTC midnight
 *  on the 1st, matching how `monthStart()` in server/billing/limits.ts
 *  measures episode/generation counts. */
export function currentMonthKey(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Read the current-month regen count for one kind. Returns 0 when no
 * row exists yet (first regen of the month).
 */
export async function getRegenCount(
  agencyId: string,
  kind: RegenKind,
  month = currentMonthKey(),
): Promise<number> {
  const row = await prisma.agencyRegenCounter.findUnique({
    where: { agencyId_month: { agencyId, month } },
    select: {
      clipRegens: true,
      artworkRegens: true,
      audiogramRegens: true,
    },
  });
  if (!row) return 0;
  return row[KIND_TO_COLUMN[kind]];
}

/**
 * Read all three counters at once — used by the UI to render regen-quota
 * meters on the Clips / Artwork / Audiogram tabs without three round
 * trips.
 */
export async function getAllRegenCounts(
  agencyId: string,
  month = currentMonthKey(),
): Promise<{ clip: number; artwork: number; audiogram: number }> {
  const row = await prisma.agencyRegenCounter.findUnique({
    where: { agencyId_month: { agencyId, month } },
    select: {
      clipRegens: true,
      artworkRegens: true,
      audiogramRegens: true,
    },
  });
  return {
    clip: row?.clipRegens ?? 0,
    artwork: row?.artworkRegens ?? 0,
    audiogram: row?.audiogramRegens ?? 0,
  };
}

/**
 * Atomic capacity check + increment. Runs inside a serializable
 * transaction with `SELECT ... FOR UPDATE` semantics so two requests
 * that both see count=cap-1 can't both increment past cap.
 *
 * Returns `{ ok: true, count }` on success or `{ ok: false, count,
 * limit }` when the cap is hit — callers convert the ok=false path
 * into a user-facing error with the upgrade hint. Throws only on real
 * DB failures.
 */
export async function tryConsumeRegen(
  agencyId: string,
  kind: RegenKind,
  limit: number,
  month = currentMonthKey(),
): Promise<{ ok: true; count: number } | { ok: false; count: number; limit: number }> {
  const column = KIND_TO_COLUMN[kind];
  return prisma.$transaction(
    async (tx) => {
      // Row-lock via findUnique inside a transaction gives us MVCC
      // serialisation on Postgres — sufficient for the ~unlikely two-
      // simultaneous-clicks race.
      const existing = await tx.agencyRegenCounter.findUnique({
        where: { agencyId_month: { agencyId, month } },
      });
      const current = existing?.[column] ?? 0;
      if (current >= limit) {
        return { ok: false as const, count: current, limit };
      }
      await tx.agencyRegenCounter.upsert({
        where: { agencyId_month: { agencyId, month } },
        create: {
          agencyId,
          month,
          [column]: 1,
        },
        update: {
          [column]: { increment: 1 },
        },
      });
      return { ok: true as const, count: current + 1 };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
