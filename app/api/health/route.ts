import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";

/**
 * Health probe for uptime monitors + Vercel platform checks.
 *
 * - `db`: lightweight `SELECT 1` round-trip. Definitive: this is the only
 *   check that flips the overall status to `degraded` + the HTTP code to
 *   503, since nothing in the app works without it.
 * - `clerk` / `inngest`: config-presence only. A missing key downgrades the
 *   check to `not_configured`, not a failure — local dev without those keys
 *   is a supported mode and we don't want to page anyone for it.
 *
 * Response is always JSON; the HTTP code is the machine-readable signal.
 * Never cached (responses must reflect right-now state).
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CheckStatus = "ok" | "fail" | "not_configured";
type Check = { status: CheckStatus; latencyMs?: number; message?: string };

function configCheck(present: boolean): Check {
  return { status: present ? "ok" : "not_configured" };
}

async function dbCheck(): Promise<Check> {
  if (!process.env.DATABASE_URL) {
    return { status: "not_configured" };
  }
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "ok", latencyMs: Date.now() - started };
  } catch (err) {
    return {
      status: "fail",
      latencyMs: Date.now() - started,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET() {
  const db = await dbCheck();
  const clerk = configCheck(Boolean(process.env.CLERK_SECRET_KEY));
  const inngest = configCheck(
    // Inngest works locally without a signing key (the dev server signs its
    // own requests), so either env var counts as configured.
    Boolean(process.env.INNGEST_SIGNING_KEY || process.env.INNGEST_EVENT_KEY),
  );

  const overall: "ok" | "degraded" = db.status === "fail" ? "degraded" : "ok";

  return NextResponse.json(
    {
      status: overall,
      checks: { db, clerk, inngest },
      timestamp: new Date().toISOString(),
    },
    { status: overall === "ok" ? 200 : 503 },
  );
}
