import "server-only";

import { MemberRole } from "@prisma/client";
import { getAuthContext } from "@/server/auth/context";
import { toTenantContext, type TenantContext } from "@/server/auth/tenant";
import { prisma } from "@/server/db/client";
import { isLiveDb } from "./source";

const DEMO_AGENCY_NAME = "Northbeam Studio";

/**
 * Resolve a `TenantContext` for the current request, handling three states:
 *
 * 1. **Signed in + has Member** → use the auth context's agency + role.
 * 2. **Live DB but no member found (dev only)** → fall back to the seeded
 *    "Northbeam Studio" demo agency so `npm run db:seed` data shows up on a
 *    fresh clone. **Gated to `NODE_ENV !== "production"`** — in production
 *    the dashboard layout (`app/(dashboard)/layout.tsx`) redirects
 *    no-Member users to `/onboarding` before this branch is reachable.
 * 3. **No DB** → return a synthetic tenant; the data-source helpers ignore
 *    its `agencyId` and read from `lib/sample-data/*` instead.
 */
export async function resolveTenantContext(): Promise<TenantContext> {
  const auth = await getAuthContext();
  if (auth) return toTenantContext(auth);

  if (isLiveDb() && process.env.NODE_ENV !== "production") {
    const demo = await prisma.agency
      .findFirst({
        where: { name: DEMO_AGENCY_NAME },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      })
      .catch(() => null);
    if (demo) {
      return { agencyId: demo.id, role: MemberRole.OWNER };
    }
  }

  // Sample-data fallback — agencyId is a placeholder; data-source ignores it.
  return { agencyId: "demo", role: MemberRole.OWNER };
}
