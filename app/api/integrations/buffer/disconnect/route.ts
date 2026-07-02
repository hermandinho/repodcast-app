import { NextResponse } from "next/server";
import { MemberRole } from "@prisma/client";
import { requireAuthContext, assertRole } from "@/server/auth/context";
import { toTenantContext } from "@/server/auth/tenant";
import { disconnectBufferIntegration } from "@/server/db/integrations";

export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireAuthContext();
  assertRole(auth, [MemberRole.OWNER, MemberRole.ADMIN]);
  const ctx = toTenantContext(auth);
  const result = await disconnectBufferIntegration(ctx);
  return NextResponse.json({ ok: true, ...result });
}
