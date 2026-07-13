import "server-only";

import { BillingCycle, ClientStatus, MemberRole, type ClientBillingProfile } from "@prisma/client";
import { z } from "zod";
import { NotFoundError, ValidationError } from "@/server/auth/errors";
import { requireRole, type TenantContext } from "@/server/auth/tenant";
import { prisma } from "./client";

/**
 * Client billing profile CRUD.
 *
 * Role gating: OWNER + ADMIN only. EDITORs and REVIEWERs aren't business-
 * sensitive enough to see retainer amounts or contract dates, so both the
 * read and the write are gated. Tenancy: every operation is anchored to
 * the parent `Client.agencyId === ctx.agencyId`.
 */

const ADMIN_ROLES = [MemberRole.OWNER, MemberRole.ADMIN] as const;

// ============================================================
// Input schema
// ============================================================

/**
 * Bare ISO-4217 currency code. The wider set lives in the form's dropdown;
 * the schema accepts any 3-letter uppercase code so we don't need to redeploy
 * on a new currency. Free-form was the schema choice (`prisma/schema.prisma`)
 * to keep migrations cheap.
 */
const currencyCode = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter ISO-4217 code (e.g. USD).");

const optionalUrl = z
  .string()
  .trim()
  .max(2000)
  .url({ message: "Enter a full URL (https://…)" })
  // Reject non-http(s) protocols so a paste-error can't smuggle
  // `javascript:` / `data:` URLs into a client-facing render.
  .refine((v) => /^https?:\/\//i.test(v), {
    message: "URL must start with http:// or https://",
  })
  .optional()
  .or(z.literal("").transform(() => undefined));

const optionalEmail = z
  .string()
  .trim()
  .email()
  .max(320)
  .optional()
  .or(z.literal("").transform(() => undefined));

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal("").transform(() => undefined));

const optionalDate = z.coerce.date().optional().nullable();

const optionalNonNegativeCents = z.coerce
  .number()
  .int()
  .min(0)
  .max(10_000_000_00) // 10M USD upper bound — accidental "10000000" typos still pass; obvious nonsense rejected.
  .optional()
  .nullable();

export const clientBillingProfileInput = z
  .object({
    billingContactName: optionalText(160),
    billingContactEmail: optionalEmail,
    retainerCents: optionalNonNegativeCents,
    ratePerEpisodeCents: optionalNonNegativeCents,
    billingCycle: z.nativeEnum(BillingCycle).default(BillingCycle.MONTHLY),
    currency: currencyCode.default("USD"),
    contractStartDate: optionalDate,
    contractRenewalDate: optionalDate,
    status: z.nativeEnum(ClientStatus).default(ClientStatus.ACTIVE),
    paymentLinkUrl: optionalUrl,
    internalNotes: optionalText(4000),
  })
  // Retainer and per-episode rate are mutually exclusive — the form UI is a
  // radio, but defend at the schema layer too in case a stale tab submits
  // both. `null` for either means "no value" (used to clear a field).
  .refine(
    (data) =>
      !(
        data.retainerCents != null &&
        data.retainerCents > 0 &&
        data.ratePerEpisodeCents != null &&
        data.ratePerEpisodeCents > 0
      ),
    { message: "Set either a retainer OR a per-episode rate, not both.", path: ["retainerCents"] },
  )
  // Renewal date can't be before the contract start — catches an obvious
  // mistake at the boundary instead of letting the renewals cron misbehave.
  .refine(
    (data) =>
      !(
        data.contractStartDate &&
        data.contractRenewalDate &&
        data.contractRenewalDate.getTime() < data.contractStartDate.getTime()
      ),
    {
      message: "Renewal date must be after the contract start date.",
      path: ["contractRenewalDate"],
    },
  );

export type ClientBillingProfileInput = z.infer<typeof clientBillingProfileInput>;

// ============================================================
// Reads
// ============================================================

export async function getClientBillingProfile(
  ctx: TenantContext,
  clientId: string,
): Promise<ClientBillingProfile | null> {
  requireRole(ctx, ADMIN_ROLES);
  // Tenant gate: only return the profile when the parent client belongs to
  // this agency. We could `findUnique` by `clientId` directly, but the join
  // makes the cross-tenant case fall out as null rather than a row leak.
  return prisma.clientBillingProfile.findFirst({
    where: {
      clientId,
      client: { agencyId: ctx.agencyId },
    },
  });
}

/**
 * Count episodes created for this client in the current calendar month.
 * Feeds the "This period" card on the billing tab so the agency can see
 * rate × episodes without touching the internal cost surface. Tenant-
 * gated the same way as the profile read — a cross-agency clientId
 * returns 0 rather than a leak.
 */
export async function episodesForClientThisMonth(
  ctx: TenantContext,
  clientId: string,
): Promise<number> {
  requireRole(ctx, ADMIN_ROLES);
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return prisma.episode.count({
    where: {
      show: { client: { id: clientId, agencyId: ctx.agencyId } },
      createdAt: { gte: from, lt: to },
    },
  });
}

// ============================================================
// Writes
// ============================================================

/**
 * Upsert the billing profile for `clientId`. Verifies the client belongs
 * to the agency before touching the profile row, so a cross-tenant id can't
 * create or update a profile under another agency's client.
 */
export async function upsertClientBillingProfile(
  ctx: TenantContext,
  clientId: string,
  input: ClientBillingProfileInput,
): Promise<ClientBillingProfile> {
  requireRole(ctx, ADMIN_ROLES);

  const client = await prisma.client.findFirst({
    where: { id: clientId, agencyId: ctx.agencyId },
    select: { id: true },
  });
  if (!client) throw new NotFoundError(`Client ${clientId} not found`);

  // Normalise: an empty string or `0` from the form means "no value" —
  // store as null so the meters / cron read it cleanly. The Zod schema
  // has already done most of this; this is the last-mile shape.
  const retainerCents =
    input.retainerCents != null && input.retainerCents > 0 ? input.retainerCents : null;
  const ratePerEpisodeCents =
    input.ratePerEpisodeCents != null && input.ratePerEpisodeCents > 0
      ? input.ratePerEpisodeCents
      : null;

  if (retainerCents != null && ratePerEpisodeCents != null) {
    // Belt-and-braces — the Zod refine catches this too. Surfaces a
    // ValidationError (422) instead of a generic 500 if the schema is
    // ever relaxed.
    throw new ValidationError("Set either a retainer OR a per-episode rate, not both.");
  }

  return prisma.clientBillingProfile.upsert({
    where: { clientId },
    create: {
      clientId,
      billingContactName: input.billingContactName ?? null,
      billingContactEmail: input.billingContactEmail ?? null,
      retainerCents,
      ratePerEpisodeCents,
      billingCycle: input.billingCycle,
      currency: input.currency.toUpperCase(),
      contractStartDate: input.contractStartDate ?? null,
      contractRenewalDate: input.contractRenewalDate ?? null,
      status: input.status,
      paymentLinkUrl: input.paymentLinkUrl ?? null,
      internalNotes: input.internalNotes ?? null,
    },
    update: {
      billingContactName: input.billingContactName ?? null,
      billingContactEmail: input.billingContactEmail ?? null,
      retainerCents,
      ratePerEpisodeCents,
      billingCycle: input.billingCycle,
      currency: input.currency.toUpperCase(),
      contractStartDate: input.contractStartDate ?? null,
      contractRenewalDate: input.contractRenewalDate ?? null,
      status: input.status,
      paymentLinkUrl: input.paymentLinkUrl ?? null,
      internalNotes: input.internalNotes ?? null,
    },
  });
}
