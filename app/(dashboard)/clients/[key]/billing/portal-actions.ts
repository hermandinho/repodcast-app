"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import { isLiveDb } from "@/server/data/source";
import {
  createPortalLink,
  createPortalLinkInput,
  revokePortalLink,
} from "@/server/db/client-portal";

/**
 * Phase 2.5 — mint / revoke client portal links from the agency UI.
 *
 * Both actions revalidate the client billing tab so the `PortalLinksCard`
 * picks up the new row (or the revoked stamp) on the next render.
 * Sample-data mode short-circuits to a synthetic success — the design
 * preview exercises the form without a `DATABASE_URL`.
 */

export type MintPortalLinkResult =
  { ok: true; data: { token: string; expiresAtIso: string } } | { ok: false; error: string };

export type RevokePortalLinkResult = { ok: true } | { ok: false; error: string };

export async function mintPortalLinkAction(raw: unknown): Promise<MintPortalLinkResult> {
  const parsed = createPortalLinkInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid portal-link input", parsed.error.issues);
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

  const auth = await requireAuthContext();
  const link = await createPortalLink(toTenantContext(auth), parsed.data, auth.member.id);

  // The billing tab reads the link list via getClientForUI's parent
  // route, but the list is rendered as part of /clients/[key]/billing.
  // Revalidate that layout so the new row appears.
  revalidatePath(`/clients/${parsed.data.clientId}/billing`);

  return {
    ok: true,
    data: { token: link.token, expiresAtIso: link.expiresAt.toISOString() },
  };
}

const revokeInput = z.object({
  linkId: z.string().min(1),
  clientId: z.string().min(1),
});

export async function revokePortalLinkAction(raw: unknown): Promise<RevokePortalLinkResult> {
  const parsed = revokeInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid revoke input", parsed.error.issues);
  }

  if (!isLiveDb()) return { ok: true };

  const auth = await requireAuthContext();
  await revokePortalLink(toTenantContext(auth), parsed.data.linkId);
  revalidatePath(`/clients/${parsed.data.clientId}/billing`);
  return { ok: true };
}
