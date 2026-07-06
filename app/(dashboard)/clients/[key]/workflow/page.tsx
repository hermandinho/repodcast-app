import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MemberRole } from "@prisma/client";
import { WorkflowForm } from "@/components/clients/workflow-form";
import { getAgencyPlan } from "@/server/billing/limits";
import { getClient } from "@/server/db/clients";
import { getClientForUI, isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";

/**
 * Per-client workflow settings — validation mode + notification recipients.
 * OWNER/ADMIN only; EDITOR/REVIEWER hitting the URL redirect back to the
 * client overview (mirrors the guard on the statements page).
 *
 * Plan gate: the whole tab is portal-adjacent — CLIENT validation mode
 * routes approvals through the client portal (AGENCY+), and the
 * notification emails power portal events (review requested / client
 * approved / revision requested). Below AGENCY the tab shows an
 * upgrade prompt instead of a form the operator can't productively act
 * on. Mirrors the `PORTAL_MIN_PLAN` gate on `PortalLinksCard`.
 */
export default async function ClientWorkflowPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const tenant = await resolveTenantContext();
  if (tenant.role !== MemberRole.OWNER && tenant.role !== MemberRole.ADMIN) {
    redirect(`/clients/${key}`);
  }

  const clientUi = await getClientForUI(tenant, key);
  if (!clientUi) notFound();

  // Sample-data mode has no Client row to update — surface a disabled preview
  // so the tab still renders when demoing.
  if (!isLiveDb()) {
    return (
      <div className="border-border bg-surface rounded-2xl border p-6 text-[13px] text-[#3A4152]">
        Workflow settings need a live database. Switch out of sample-data mode to configure
        validation and notification recipients.
      </div>
    );
  }

  const plan = await getAgencyPlan(tenant.agencyId);
  const planUnlocksWorkflow = plan === "AGENCY" || plan === "NETWORK";

  if (!planUnlocksWorkflow) {
    return (
      <div className="mx-auto max-w-[720px]">
        <WorkflowUpgradePrompt />
      </div>
    );
  }

  const [client, ownerMember] = await Promise.all([
    getClient(tenant, clientUi.key),
    prisma.member.findFirst({
      where: { agencyId: tenant.agencyId, role: MemberRole.OWNER },
      select: { email: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-[720px]">
      <WorkflowForm
        clientId={client.id}
        initialValidationMode={client.validationMode}
        initialNotificationEmails={client.notificationEmails}
        ownerEmail={ownerMember?.email ?? null}
      />
    </div>
  );
}

/**
 * Inline upsell shown on Solo / Studio when an OWNER/ADMIN opens the
 * workflow tab. Styled to match the portal-mint upgrade banner in
 * `PortalLinksCard` so the "you need Agency to touch portals" story
 * reads the same in both places. The tab itself stays visible on lower
 * plans (users need to see WHY it isn't editable), but the form is
 * replaced with this card.
 */
function WorkflowUpgradePrompt() {
  return (
    <div className="border-border bg-surface rounded-2xl border p-6">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-[3px] inline-flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
          style={{ background: "#FBF1DE", color: "#A06D12" }}
        >
          ↑
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-ink text-[15px] font-semibold">
            Client-approval workflow unlocks on the Agency plan.
          </h2>
          <p className="text-muted mt-1 max-w-[560px] text-[12.5px] leading-[1.55]">
            The workflow tab routes approvals through the client portal and fans notifications out
            to the recipients you configure here. Both features are Agency-and-up. Your current plan
            approves outputs internally by default — every generated post goes through your team.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link
              href="/settings/billing"
              className="rounded-md bg-[#0A1E3C] px-3 py-[7px] font-sans text-[12.5px] font-semibold text-white no-underline hover:brightness-110"
            >
              Upgrade to Agency
            </Link>
            <Link
              href="/pricing"
              className="text-muted-2 hover:text-ink rounded-md px-2 py-[7px] font-sans text-[12.5px] font-semibold no-underline"
            >
              Compare plans →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
