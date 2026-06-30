"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/auth/errors";
import {
  clearImpersonationCookie,
  encodeImpersonationCookie,
  readImpersonationPayload,
  setImpersonationCookie,
} from "@/server/auth/impersonation";
import { requireSystemAdminContext } from "@/server/auth/system";
import { endImpersonation, startImpersonation } from "@/server/db/system/impersonation";

const startInput = z.object({
  agencyId: z.string().min(1),
  memberId: z.string().min(1),
});

async function clientHeaders(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const h = await headers();
  // Vercel sets `x-forwarded-for` as a comma-separated list; the first hop is
  // the actual client. The remaining hops are trusted proxies. We don't
  // dereference further — the IP exists only for audit context, not auth.
  const forwarded = h.get("x-forwarded-for");
  const ipAddress = forwarded ? (forwarded.split(",")[0]?.trim() ?? null) : null;
  return { ipAddress, userAgent: h.get("user-agent") };
}

/**
 * Open a read-only impersonation envelope for `memberId` within `agencyId`.
 * On success the request's `repodcast_impersonate` cookie is set and the
 * user is redirected to `/dashboard` — every subsequent tenant page reads
 * the cookie and swaps the resolved context.
 *
 * Failure modes (each redirects back to the agency drilldown with an
 * `impersonate_error` query so the page can surface a toast):
 *   - caller is not a SystemAdmin (handled upstream by `requireSystemAdminContext`)
 *   - caller's role isn't in SYSTEM_WRITE_ROLES → ForbiddenError
 *   - member doesn't match the supplied agencyId → NotFoundError
 *   - IMPERSONATION_SIGNING_KEY missing → throws (we want this in the logs)
 */
export async function startImpersonationAction(formData: FormData): Promise<void> {
  const parsed = startInput.safeParse({
    agencyId: formData.get("agencyId"),
    memberId: formData.get("memberId"),
  });
  if (!parsed.success) {
    throw new ValidationError(parsed.error.message);
  }

  const ctx = await requireSystemAdminContext();

  // Probe the signing key BEFORE writing the audit row. Minting the cookie
  // is the load-bearing side-effect; if the env is missing we never want to
  // leave an IMPERSONATE_START row without a matching envelope.
  const probe = encodeImpersonationCookie({
    systemAdminId: ctx.admin.id,
    asMemberId: parsed.data.memberId,
    agencyId: parsed.data.agencyId,
    mode: "read",
    startedAt: new Date().toISOString(),
  });
  if (!probe) {
    redirect(`/root/agencies/${parsed.data.agencyId}?impersonate_error=signing_key_missing`);
  }

  const { ipAddress, userAgent } = await clientHeaders();

  let started;
  try {
    started = await startImpersonation(ctx, {
      agencyId: parsed.data.agencyId,
      memberId: parsed.data.memberId,
      ipAddress,
      userAgent,
    });
  } catch (err) {
    const code = errCode(err);
    redirect(`/root/agencies/${parsed.data.agencyId}?impersonate_error=${code}`);
  }

  await setImpersonationCookie({
    systemAdminId: started.systemAdminId,
    asMemberId: started.memberId,
    agencyId: started.agencyId,
    mode: "read",
    startedAt: started.startedAt.toISOString(),
  });

  redirect("/dashboard");
}

/**
 * Close the active impersonation envelope. Reads the cookie payload back
 * (for the audit row's targets), clears the cookie, writes the audit row,
 * and redirects to the originating agency drilldown.
 *
 * Idempotent: calling without an active envelope is a no-op redirect — no
 * audit row, no throw.
 */
export async function endImpersonationAction(): Promise<void> {
  const ctx = await requireSystemAdminContext();
  const payload = await readImpersonationPayload();

  if (!payload) {
    redirect("/root");
  }

  const { ipAddress, userAgent } = await clientHeaders();

  await endImpersonation(ctx, {
    agencyId: payload.agencyId,
    memberId: payload.asMemberId,
    startedAt: payload.startedAt,
    ipAddress,
    userAgent,
  });

  await clearImpersonationCookie();
  // Surface the change immediately for any in-flight server components.
  revalidatePath("/", "layout");

  redirect(`/root/agencies/${payload.agencyId}?impersonation_ended=1`);
}

function errCode(err: unknown): string {
  if (err instanceof NotFoundError) return "not_found";
  if (err instanceof ForbiddenError) return "forbidden";
  if (err instanceof ValidationError) return "invalid";
  return "unknown";
}
