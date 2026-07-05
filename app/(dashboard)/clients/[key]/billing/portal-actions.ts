"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuthContext } from "@/server/auth/context";
import { AppError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import { isLiveDb } from "@/server/data/source";
import {
  createPortalLink,
  createPortalLinkInput,
  revokePortalLink,
} from "@/server/db/client-portal";
import { notifyClientPortalLinkShared } from "@/server/db/notifications";

/**
 * Phase 2.5 — mint / revoke client portal links from the agency UI.
 *
 * Both actions revalidate the client billing tab so the `PortalLinksCard`
 * picks up the new row (or the revoked stamp) on the next render.
 * Sample-data mode short-circuits to a synthetic success — the design
 * preview exercises the form without a `DATABASE_URL`.
 *
 * Domain errors (plan gate, tenant mismatch, validation) are converted to
 * `{ ok: false, error }`. Uncaught throws from a Server Action get their
 * message redacted in production — the client would see only React's
 * generic "An error occurred in the Server Components render" digest text
 * instead of the actionable copy (e.g. "Plan STUDIO doesn't include this
 * feature. Upgrade to AGENCY or higher.").
 */

export type MintPortalLinkResult =
  { ok: true; data: { token: string; expiresAtIso: string } } | { ok: false; error: string };

export type RevokePortalLinkResult = { ok: true } | { ok: false; error: string };

export async function mintPortalLinkAction(raw: unknown): Promise<MintPortalLinkResult> {
  const parsed = createPortalLinkInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid input." };
  }

  if (!isLiveDb()) {
    return {
      ok: true,
      data: {
        token: `sample_${Date.now().toString(36)}`,
        expiresAtIso: new Date(
          Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000,
        ).toISOString(),
      },
    };
  }

  try {
    const auth = await requireAuthContext();
    const link = await createPortalLink(toTenantContext(auth), parsed.data, auth.member.id);

    // Fire-and-forget email to the client's contactEmail with the URL
    // and (when set) the shared password. `notifyClientPortalLinkShared`
    // no-ops cleanly when contactEmail is unset, so we don't gate on it
    // here. A Resend failure never blocks the mint — the operator still
    // has the URL on the billing tab.
    void notifyClientPortalLinkShared(link.id);

    revalidatePath(`/clients/${parsed.data.clientId}/billing`);

    return {
      ok: true,
      data: { token: link.token, expiresAtIso: link.expiresAt.toISOString() },
    };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message };
    throw err;
  }
}

const revokeInput = z.object({
  linkId: z.string().min(1),
  clientId: z.string().min(1),
});

export async function revokePortalLinkAction(raw: unknown): Promise<RevokePortalLinkResult> {
  const parsed = revokeInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Invalid input." };
  }

  if (!isLiveDb()) return { ok: true };

  try {
    const auth = await requireAuthContext();
    await revokePortalLink(toTenantContext(auth), parsed.data.linkId);
    revalidatePath(`/clients/${parsed.data.clientId}/billing`);
    return { ok: true };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message };
    throw err;
  }
}
