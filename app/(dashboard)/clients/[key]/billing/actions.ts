"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ValidationError } from "@/server/auth/errors";
import { requireAuthContext } from "@/server/auth/context";
import { toTenantContext } from "@/server/auth/tenant";
import { clientBillingProfileInput, upsertClientBillingProfile } from "@/server/db/client-billing";
import { isLiveDb } from "@/server/data/source";

export type BillingActionResult =
  { ok: true; data: { clientId: string } } | { ok: false; error: string };

const updateInput = z.object({
  clientId: z.string().min(1),
  profile: clientBillingProfileInput,
});

/**
 * Phase 2.13.2 — write the billing profile for a client. Role-gated to
 * OWNER/ADMIN via the repo `requireRole`; cross-tenant ids land as
 * NotFoundError on the parent-client lookup.
 *
 * Sample-data mode short-circuits to a synthetic success so the design
 * preview can flow through the form without touching the DB.
 */
export async function updateClientBillingProfileAction(raw: unknown): Promise<BillingActionResult> {
  const parsed = updateInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid billing input", parsed.error.issues);
  }
  const { clientId, profile } = parsed.data;

  if (!isLiveDb()) {
    return { ok: true, data: { clientId } };
  }

  const auth = await requireAuthContext();

  try {
    await upsertClientBillingProfile(toTenantContext(auth), clientId, profile);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't save billing profile.",
    };
  }

  // The header card + Billing tab content both read this row; revalidate
  // the whole client subtree so the next render is fresh.
  revalidatePath(`/clients/${clientId}`, "layout");
  return { ok: true, data: { clientId } };
}
