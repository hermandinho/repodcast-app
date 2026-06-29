import { MemberRole, Plan, type Member, type MemberInvite } from "@prisma/client";
import { getAuthContext } from "@/server/auth/context";
import { planCapacity } from "@/server/billing/limits";
import { planLimitsFor } from "@/lib/plans";
import { isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";
import { listPendingInvites } from "@/server/db/invites";
import { listMemberTransitions } from "@/server/db/member-transitions";
import { InviteMemberForm } from "@/components/settings/invite-member-form";
import { MemberActivityFeed } from "@/components/settings/member-activity-feed";
import { MemberRow } from "@/components/settings/member-row";
import { PendingInviteRow } from "@/components/settings/pending-invite-row";

export default async function TeamPage() {
  // Use the shared resolver so we work in three states cleanly:
  //   - signed in + Member synced → real auth context
  //   - signed in but Member missing (webhook pending) → resolved demo agency
  //   - DB not configured → synthetic demo tenant + sample fallback
  const tenant = await resolveTenantContext();
  const auth = await getAuthContext();

  // Determine plan from the real Agency row when available, else STUDIO baseline.
  const agency = isLiveDb()
    ? await prisma.agency
        .findUnique({
          where: { id: tenant.agencyId },
          select: { plan: true },
        })
        .catch(() => null)
    : null;
  const plan: Plan = agency?.plan ?? Plan.STUDIO;

  // Member list: live rows when DB is reachable, synthetic single-member fallback otherwise.
  const liveMembers = isLiveDb()
    ? await prisma.member
        .findMany({
          where: { agencyId: tenant.agencyId },
          orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        })
        .catch(() => null)
    : null;
  const members: Member[] = liveMembers ?? makeSampleMembers(auth);

  // Pending invites — only show to OWNER/ADMIN viewers (the only roles
  // that can revoke). Editors don't get to see the queue.
  const canManageInvites =
    (auth?.member.role ?? MemberRole.OWNER) === MemberRole.OWNER ||
    (auth?.member.role ?? MemberRole.OWNER) === MemberRole.ADMIN;
  const pendingInvites: MemberInvite[] =
    isLiveDb() && canManageInvites ? await listPendingInvites(tenant).catch(() => []) : [];

  // Activity feed — visible to all roles (audit log is a read for everyone).
  // Capped at 20 rows; we'll add pagination if a churny agency outgrows it.
  const memberTransitions = isLiveDb()
    ? await listMemberTransitions(tenant, 20).catch(() => [])
    : [];

  const capacity = isLiveDb()
    ? await planCapacity(tenant.agencyId, plan, "members")
    : { used: members.length, limit: planLimitsFor(plan).seats };

  // Sample-data mode keeps the form's banner empty so the design preview
  // doesn't surface synthetic-tenant warnings.
  const bannerCapacity = isLiveDb() ? { ...capacity, plan, resource: "members" as const } : null;

  const seatsRemaining = Math.max(0, capacity.limit - capacity.used);
  const viewerMemberId = auth?.member.id ?? members[0]?.id ?? "";
  const viewerRole = auth?.member.role ?? MemberRole.OWNER;

  return (
    <>
      <div className="border-border bg-surface shadow-card mb-[18px] rounded-3xl border p-5">
        <div className="mb-[14px] flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <div className="font-display text-ink text-[16px] font-semibold">Members</div>
            <div className="text-muted-2 mt-[3px] text-[12.5px]">
              {members.length} of {capacity.limit} seats used · {seatsRemaining} left on the {plan}{" "}
              plan
            </div>
          </div>
        </div>

        <div>
          {members.length === 0 ? (
            <div className="text-muted-2 py-6 text-center text-[12.5px]">
              No members yet — invite teammates below.
            </div>
          ) : (
            members.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                isSelf={m.id === viewerMemberId}
                viewerRole={viewerRole}
              />
            ))
          )}
        </div>
      </div>

      {pendingInvites.length > 0 && (
        <div className="border-border bg-surface shadow-card mb-[18px] rounded-3xl border p-5">
          <div className="mb-[14px]">
            <div className="font-display text-ink text-[16px] font-semibold">Pending invites</div>
            <div className="text-muted-2 mt-[3px] text-[12.5px]">
              {pendingInvites.length} waiting to be accepted · expire after 14 days
            </div>
          </div>
          <div>
            {pendingInvites.map((inv) => (
              <PendingInviteRow key={inv.id} invite={inv} />
            ))}
          </div>
        </div>
      )}

      <div className="border-border bg-surface shadow-card rounded-3xl border p-5">
        <div className="mb-[14px]">
          <div className="font-display text-ink text-[16px] font-semibold">Invite a teammate</div>
          <div className="text-muted-2 mt-[3px] text-[12.5px]">
            They&apos;ll get an email with a link to join. Editors generate + edit; Admins also
            manage team and billing.
          </div>
        </div>
        <InviteMemberForm seatsRemaining={seatsRemaining} capacity={bannerCapacity} />
      </div>

      {isLiveDb() && (
        <div className="border-border bg-surface shadow-card mt-[18px] rounded-3xl border p-5">
          <div className="mb-[14px]">
            <div className="font-display text-ink text-[16px] font-semibold">
              Recent team activity
            </div>
            <div className="text-muted-2 mt-[3px] text-[12.5px]">
              Audit trail of invites, role changes, removals, and ownership transfers.
            </div>
          </div>
          <MemberActivityFeed items={memberTransitions} />
        </div>
      )}
    </>
  );
}

/**
 * Synthetic single-member list used when the DB isn't configured OR the
 * caller isn't synced yet. Reflects whatever we *do* know about the user
 * from Clerk.
 */
function makeSampleMembers(
  auth: {
    user: { clerkUserId: string; email: string; name: string | null };
    member: { id: string };
  } | null,
): Member[] {
  const now = new Date();
  return [
    {
      id: auth?.member.id || "demo-owner",
      agencyId: "demo",
      clerkUserId: auth?.user.clerkUserId ?? "user_demo",
      role: MemberRole.OWNER,
      email: auth?.user.email || "you@example.com",
      name: auth?.user.name ?? "You",
      createdAt: now,
      updatedAt: now,
    },
  ];
}
