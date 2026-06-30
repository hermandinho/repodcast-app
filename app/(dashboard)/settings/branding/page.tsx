import { MemberRole } from "@prisma/client";
import { BrandingForm } from "@/components/settings/branding-form";
import { getAuthContext } from "@/server/auth/context";
import { isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";

export default async function BrandingPage() {
  const [tenant, auth] = await Promise.all([resolveTenantContext(), getAuthContext()]);

  // Live DB read with a sample-data fallback — mirrors the agency settings
  // page so a fresh clone renders cleanly without `DATABASE_URL`.
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
    <div className="border-border bg-surface shadow-card rounded-3xl border p-6">
      <div className="mb-5">
        <div className="text-muted-2 font-sans text-[11.5px] font-semibold tracking-[0.06em] uppercase">
          White-label
        </div>
        <div className="font-display text-ink mt-1 text-[18px] font-semibold">
          Client-facing branding
        </div>
        <p className="text-muted mt-1 max-w-[640px] text-[12.5px] leading-[1.55]">
          Logo and accent color used on the client portal and branded exports. The Repodcast
          dashboard itself stays on our default theme — these settings only affect surfaces your
          clients see.
        </p>
      </div>

      <BrandingForm
        agencyName={name}
        initialLogoUrl={agency?.brandLogoUrl ?? null}
        initialAccentColor={agency?.brandAccentColor ?? null}
        canEdit={canEdit}
      />
    </div>
  );
}
