import { NextResponse } from "next/server";
import { MemberRole } from "@prisma/client";
import { requireAuthContext, assertRole } from "@/server/auth/context";
import { toTenantContext } from "@/server/auth/tenant";
import { IntegrationNotFoundError, refreshBufferChannels } from "@/server/db/integrations";
import { BufferError } from "@/server/integrations/buffer";

export const dynamic = "force-dynamic";

/**
 * Re-enumerate the connected Buffer account's channels + orgs and refresh
 * `meta`. Called from the settings card when a user adds a new social
 * channel in Buffer and needs Repodcast to pick it up.
 */
export async function POST() {
  const auth = await requireAuthContext();
  assertRole(auth, [MemberRole.OWNER, MemberRole.ADMIN]);
  const ctx = toTenantContext(auth);
  try {
    const summary = await refreshBufferChannels(ctx);
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    if (err instanceof IntegrationNotFoundError) {
      return NextResponse.json({ ok: false, error: "Buffer isn't connected." }, { status: 404 });
    }
    if (err instanceof BufferError) {
      return NextResponse.json(
        { ok: false, error: `Buffer rejected the refresh: ${err.message}` },
        { status: 502 },
      );
    }
    throw err;
  }
}
