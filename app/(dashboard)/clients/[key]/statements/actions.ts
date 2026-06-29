"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import {
  generateClientStatement,
  generateClientStatementInput,
} from "@/server/db/client-statements";
import { isLiveDb } from "@/server/data/source";

export type GenerateStatementResult =
  { ok: true; data: { statementId: string } } | { ok: false; error: string };

const actionInput = z.object({
  clientId: z.string().min(1),
  period: generateClientStatementInput,
});

/**
 * Phase 2.13.4 — generate a new client statement. OWNER/ADMIN-gated via
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
