"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import {
  generateClientStatement,
  generateClientStatementInput,
  shareStatementWithPortal,
  unshareStatementFromPortal,
} from "@/server/db/client-statements";
import { isLiveDb } from "@/server/data/source";

export type GenerateStatementResult =
  { ok: true; data: { statementId: string } } | { ok: false; error: string };

const actionInput = z.object({
  clientId: z.string().min(1),
  period: generateClientStatementInput,
});

/**
 * Generate a new client statement. OWNER/ADMIN-gated via
 * the repo's `requireRole`. The client redirects to the new statement's
 * detail page on success.
 *
 * Sample-data mode short-circuits with a synthetic id so the flow stays
 * demoable without a DB.
 */
export async function generateClientStatementAction(
  raw: unknown,
): Promise<GenerateStatementResult> {
  const parsed = actionInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid statement input", parsed.error.issues);
  }
  const { clientId, period } = parsed.data;

  if (!isLiveDb()) {
    return { ok: true, data: { statementId: "demo-statement" } };
  }

  const auth = await requireAuthContext();
  try {
    const statement = await generateClientStatement(
      toTenantContext(auth),
      clientId,
      auth.member.id,
      period,
    );
    revalidatePath(`/clients/${clientId}/statements`);
    return { ok: true, data: { statementId: statement.id } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Statement generation failed.",
    };
  }
}

// ============================================================
// Publish / unpublish a statement to the client portal
// ============================================================

const shareInput = z.object({
  clientKey: z.string().min(1),
  statementId: z.string().min(1),
});

export type ShareStatementResult = { ok: true } | { ok: false; error: string };

/**
 * Toggle the portal-visibility flag on a statement. `share=true` publishes
 * (idempotent), `share=false` unpublishes. Revalidates the detail + list
 * paths so the row's badge + button labels re-render on both surfaces.
 *
 * Sample-data mode returns a no-op success — same shape as the generate
 * action — so the button doesn't error on the demo route.
 */
export async function shareStatementAction(
  raw: { clientKey: string; statementId: string; share: boolean } | unknown,
): Promise<ShareStatementResult> {
  const parsed = shareInput.extend({ share: z.boolean() }).safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid share input", parsed.error.issues);
  }
  const { clientKey, statementId, share } = parsed.data;

  if (!isLiveDb()) return { ok: true };

  const auth = await requireAuthContext();
  try {
    const ctx = toTenantContext(auth);
    if (share) {
      await shareStatementWithPortal(ctx, statementId, auth.member.id);
    } else {
      await unshareStatementFromPortal(ctx, statementId);
    }
    revalidatePath(`/clients/${clientKey}/statements`);
    revalidatePath(`/clients/${clientKey}/statements/${statementId}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Share failed.",
    };
  }
}
