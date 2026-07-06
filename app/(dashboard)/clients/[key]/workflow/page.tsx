import { notFound, redirect } from "next/navigation";
import { MemberRole } from "@prisma/client";
import { WorkflowForm } from "@/components/clients/workflow-form";
import { getClient } from "@/server/db/clients";
import { getClientForUI, isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";

/**
 * Per-client workflow settings — validation mode + notification recipients.
 * OWNER/ADMIN only; EDITOR/REVIEWER hitting the URL redirect back to the
 * client overview (mirrors the guard on the statements page).
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
