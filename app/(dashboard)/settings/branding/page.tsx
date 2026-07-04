import { MemberRole } from "@prisma/client";
import { BrandingForm } from "@/components/settings/branding-form";
import { getAuthContext } from "@/server/auth/context";
import { isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";

/**
 * Settings · Branding — revamp visual system (see `ref/UI/Revamp/` 2b).
 * All the layout lives inside `<BrandingForm>` (two-column controls +
 * live portal preview). The page is just the data-fetch shell.
 */
export default async function BrandingPage() {
  const [tenant, auth] = await Promise.all([resolveTenantContext(), getAuthContext()]);

  const live = isLiveDb();
  const agency = live
    ? await prisma.agency
        .findUnique({
          where: { id: tenant.agencyId },
          select: { name: true, brandLogoUrl: true, brandAccentColor: true },
        })
        .catch(() => null)
    : null;

  const name = agency?.name ?? auth?.agency.name ?? "Northbeam Studio";
  const role = auth?.member.role ?? MemberRole.OWNER;
  const canEdit = role === MemberRole.OWNER || role === MemberRole.ADMIN;

  return (
    <div style={{ maxWidth: 1060, fontFamily: "var(--font-revamp-sans)" }}>
      <BrandingForm
        agencyName={name}
        initialLogoUrl={agency?.brandLogoUrl ?? null}
        initialAccentColor={agency?.brandAccentColor ?? null}
        canEdit={canEdit}
      />
    </div>
  );
}
