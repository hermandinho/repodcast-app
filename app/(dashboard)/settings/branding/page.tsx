import { MemberRole, Plan } from "@prisma/client";
import { FeatureUpgradePrompt } from "@/components/billing/feature-upgrade-prompt";
import { BrandingForm } from "@/components/settings/branding-form";
import { WhiteLabelPreview } from "@/components/settings/branding-preview";
import { planIncludesFeature } from "@/lib/plan-features";
import { getAuthContext } from "@/server/auth/context";
import { getAgencyPlan } from "@/server/billing/limits";
import { isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";

/**
 * Settings · Branding — revamp visual system (see `ref/UI/Revamp/` 2b).
 * All the layout lives inside `<BrandingForm>` (two-column controls +
 * live portal preview). The page is just the data-fetch shell.
 *
 * Plan gate: `brandLogoUrl` requires AGENCY and `brandAccentColor`
 * requires NETWORK (see `server/db/agencies.ts#updateAgencyBranding`).
 * Below AGENCY the whole form is replaced with a `FeatureUpgradePrompt`
 * — no point in rendering controls the save action would reject. On
 * AGENCY the form works but the accent picker itself shows a nested
 * prompt for the NETWORK-only upgrade.
 */
export default async function BrandingPage() {
  const [tenant, auth] = await Promise.all([resolveTenantContext(), getAuthContext()]);

  const live = isLiveDb();
  const [agency, plan] = await Promise.all([
    live
      ? prisma.agency
          .findUnique({
            where: { id: tenant.agencyId },
            select: { name: true, brandLogoUrl: true, brandAccentColor: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
    live ? getAgencyPlan(tenant.agencyId).catch(() => Plan.NETWORK) : Promise.resolve(Plan.NETWORK),
  ]);

  const name = agency?.name ?? auth?.agency.name ?? "Northbeam Studio";
  const role = auth?.member.role ?? MemberRole.OWNER;
  const canEdit = role === MemberRole.OWNER || role === MemberRole.ADMIN;
  const unlocksWhiteLabel = planIncludesFeature(plan, "whiteLabel");

  if (!unlocksWhiteLabel) {
    return (
      <div style={{ maxWidth: 1060, fontFamily: "var(--font-revamp-sans)" }}>
        <FeatureUpgradePrompt
          feature="whiteLabel"
          preview={<WhiteLabelPreview agencyName={name} />}
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1060, fontFamily: "var(--font-revamp-sans)" }}>
      <BrandingForm
        agencyName={name}
        initialLogoUrl={agency?.brandLogoUrl ?? null}
        initialAccentColor={agency?.brandAccentColor ?? null}
        canEdit={canEdit}
        plan={plan}
      />
    </div>
  );
}
