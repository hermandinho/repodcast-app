import "server-only";

import type { AgencyAttribution, Prisma } from "@prisma/client";
import { prisma } from "./client";

/**
 * Attribution capture.
 *
 * The write side is `captureAttribution`, called exactly once from within
 * `createWorkspaceAction` right after the Agency row is created. The read
 * side is `getAttributionFor`, used by the ROOT funnel view — tenant-side
 * code has no legitimate reason to read this table.
 *
 * Attribution is derived from the client-side capture in
 * `components/analytics/attribution-capture.tsx` — the sanitized blob
 * arrives in a first-party cookie which the server action forwards to
 * `captureAttribution`. Missing/malformed values silently drop; a totally
 * empty capture still writes a row (so we can count "direct" arrivals
 * as their own attribution bucket).
 */

/**
 * Sanitized attribution payload shape. Every field is optional to reflect
 * the reality that the browser might supply none, some, or all of them.
 * Strings are pre-trimmed and length-clamped by the caller.
 */
export type AttributionInput = {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  utmTerm?: string | null;
  referrer?: string | null;
  landingPath?: string | null;
  signupPath?: string | null;
  gclid?: string | null;
  fbclid?: string | null;
};

/** Individual value length cap. Long enough for real utm strings and
 *  referrer URLs, short enough that a malicious client can't fill the
 *  column with a novel. */
const FIELD_MAX_LEN = 500;

function clampString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, FIELD_MAX_LEN);
}

/**
 * Upsert the attribution row for `agencyId`. Idempotent — re-running with
 * different values updates in place (used when the same user retries
 * onboarding and we want to keep the freshest capture).
 *
 * NEVER throws on bad input — attribution is best-effort. If Postgres
 * rejects the write for any reason, we swallow and log; the signup itself
 * must succeed regardless.
 */
export async function captureAttribution(agencyId: string, input: AttributionInput): Promise<void> {
  const data: Prisma.AgencyAttributionCreateInput = {
    agency: { connect: { id: agencyId } },
    utmSource: clampString(input.utmSource),
    utmMedium: clampString(input.utmMedium),
    utmCampaign: clampString(input.utmCampaign),
    utmContent: clampString(input.utmContent),
    utmTerm: clampString(input.utmTerm),
    referrer: clampString(input.referrer),
    landingPath: clampString(input.landingPath),
    signupPath: clampString(input.signupPath),
    gclid: clampString(input.gclid),
    fbclid: clampString(input.fbclid),
  };

  try {
    await prisma.agencyAttribution.upsert({
      where: { agencyId },
      create: data,
      update: {
        utmSource: data.utmSource,
        utmMedium: data.utmMedium,
        utmCampaign: data.utmCampaign,
        utmContent: data.utmContent,
        utmTerm: data.utmTerm,
        referrer: data.referrer,
        landingPath: data.landingPath,
        signupPath: data.signupPath,
        gclid: data.gclid,
        fbclid: data.fbclid,
      },
    });
  } catch (err) {
    // Best-effort: never let attribution failure surface to the user.
    console.error("captureAttribution failed", { agencyId, err });
  }
}

/**
 * Read the attribution row for one agency. Returns null when no row
 * exists (legacy agencies from before attribution capture, or the write failed).
 * Used by the ROOT funnel view.
 */
export async function getAttributionFor(agencyId: string): Promise<AgencyAttribution | null> {
  return prisma.agencyAttribution.findUnique({ where: { agencyId } });
}

/**
 * Aggregate signup counts grouped by utm_source in a time window. Powers
 * the ROOT `/root/funnels` "by source" table. Rows with a NULL utmSource
 * are bucketed as `direct`.
 *
 * `from` and `to` are inclusive/exclusive respectively — same shape as
 * every other reporting query in the codebase.
 */
export async function countSignupsBySource(
  from: Date,
  to: Date,
): Promise<Array<{ source: string; count: number }>> {
  const rows = await prisma.agencyAttribution.groupBy({
    by: ["utmSource"],
    where: { createdAt: { gte: from, lt: to } },
    _count: { agencyId: true },
  });
  return rows
    .map((r) => ({
      source: r.utmSource ?? "direct",
      count: r._count.agencyId,
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Aggregate signup counts grouped by utm_campaign. Used by the ROOT
 * funnel to spot which cold-outreach batches actually landed customers.
 */
export async function countSignupsByCampaign(
  from: Date,
  to: Date,
): Promise<Array<{ campaign: string; count: number }>> {
  const rows = await prisma.agencyAttribution.groupBy({
    by: ["utmCampaign"],
    where: { createdAt: { gte: from, lt: to }, utmCampaign: { not: null } },
    _count: { agencyId: true },
  });
  return rows
    .map((r) => ({
      campaign: r.utmCampaign ?? "(unknown)",
      count: r._count.agencyId,
    }))
    .sort((a, b) => b.count - a.count);
}
