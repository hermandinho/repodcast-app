import { NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth/context";
import { toTenantContext } from "@/server/auth/tenant";
import { isLiveDb, searchForUI, type SearchResultsForUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";

/**
 * Global command-palette search. Three tenant-scoped `contains` queries
 * (clients / shows / episodes) with LIMIT 5 each. Sample-data mode
 * short-circuits to filtering the seeded arrays so the palette still lights
 * up on a fresh clone.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EMPTY: SearchResultsForUI = { clients: [], shows: [], episodes: [] };

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json(EMPTY, { headers: { "Cache-Control": "no-store" } });
  }

  if (isLiveDb()) {
    const auth = await getAuthContext();
    if (!auth) {
      return NextResponse.json(EMPTY, {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const results = await searchForUI(toTenantContext(auth), q);
    return NextResponse.json(results, { headers: { "Cache-Control": "no-store" } });
  }

  const tenant = await resolveTenantContext();
  const results = await searchForUI(tenant, q);
  return NextResponse.json(results, { headers: { "Cache-Control": "no-store" } });
}
