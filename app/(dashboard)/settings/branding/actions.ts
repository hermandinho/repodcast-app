"use server";

import { revalidatePath } from "next/cache";
import { requireAuthContext } from "@/server/auth/context";
import { ValidationError } from "@/server/auth/errors";
import { toTenantContext } from "@/server/auth/tenant";
import { isLiveDb } from "@/server/data/source";
import { updateAgencyBranding, updateAgencyBrandingInput } from "@/server/db/agencies";

export type UpdateBrandingResult =
  | { ok: true; data: { brandLogoUrl: string | null; brandAccentColor: string | null } }
  | { ok: false; error: string };

/**
 * Phase 2.5 — save the agency's white-label settings.
 *
 * Sample-data mode short-circuits without touching the DB so the design
 * preview can exercise the form without a `DATABASE_URL`. The returned
 * shape mirrors live mode so the client component can render the same
 * post-save confirmation either way.
 */
export async function updateAgencyBrandingAction(raw: unknown): Promise<UpdateBrandingResult> {
  const parsed = updateAgencyBrandingInput.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid branding input", parsed.error.issues);
  }

  if (!isLiveDb()) {
    return {
      ok: true,
      data: {
        brandLogoUrl: parsed.data.brandLogoUrl,
        brandAccentColor: parsed.data.brandAccentColor,
      },
    };
  }

  const auth = await requireAuthContext();
  const updated = await updateAgencyBranding(toTenantContext(auth), parsed.data);

  // Branding lives on the agency row that lots of surfaces read from —
  // revalidate the whole dashboard layout so the topbar / portal / etc.
  // pick up the new logo + color on the next render.
  revalidatePath("/", "layout");
  return {
    ok: true,
    data: {
      brandLogoUrl: updated.brandLogoUrl,
      brandAccentColor: updated.brandAccentColor,
    },
  };
}
