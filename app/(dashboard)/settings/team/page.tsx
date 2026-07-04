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

const INK = "#0a1e3c";
const MUTED = "#41506b";
const LIGHT_MUTED = "#8a97ad";
const CARD_BORDER = "#e4e9f1";
const ROW_BORDER = "#eef1f6";
const ACCENT = "#3A5BA0";

/**
 * Settings · Team — revamp visual system (see `ref/UI/Revamp/` 2a).
 *
 * Single members card with a seat meter in the header, an inline invite
 * row on a subtle canvas strip, member rows below, and an empty-seats
 * dashed row when there's headroom. Recent activity is a separate card.
 */
export default async function TeamPage() {
  const tenant = await resolveTenantContext();
  const auth = await getAuthContext();

  const agency = isLiveDb()
    ? await prisma.agency
        .findUnique({
          where: { id: tenant.agencyId },
          select: { plan: true },
        })
        .catch(() => null)
    : null;
  const plan: Plan = agency?.plan ?? Plan.STUDIO;

  const liveMembers = isLiveDb()
    ? await prisma.member
        .findMany({
          where: { agencyId: tenant.agencyId },
          orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        })
        .catch(() => null)
    : null;
  const members: Member[] = liveMembers ?? makeSampleMembers(auth);

  const canManageInvites =
    (auth?.member.role ?? MemberRole.OWNER) === MemberRole.OWNER ||
    (auth?.member.role ?? MemberRole.OWNER) === MemberRole.ADMIN;
  const pendingInvites: MemberInvite[] =
    isLiveDb() && canManageInvites ? await listPendingInvites(tenant).catch(() => []) : [];

  const memberTransitions = isLiveDb()
    ? await listMemberTransitions(tenant, 20).catch(() => [])
    : [];

  const capacity = isLiveDb()
    ? await planCapacity(tenant.agencyId, plan, "members")
    : { used: members.length, limit: planLimitsFor(plan).seats };

  const bannerCapacity = isLiveDb() ? { ...capacity, plan, resource: "members" as const } : null;

  const seatsUsed = capacity.used;
  const seatsLimit = capacity.limit;
  const seatsRemaining = Math.max(0, seatsLimit - seatsUsed);
  const seatPct = seatsLimit > 0 ? Math.min(100, Math.round((seatsUsed / seatsLimit) * 100)) : 0;

  const viewerMemberId = auth?.member.id ?? members[0]?.id ?? "";
  const viewerRole = auth?.member.role ?? MemberRole.OWNER;

  return (
    <div style={{ maxWidth: 860, fontFamily: "var(--font-revamp-sans)" }}>
      {/* Members card */}
      <div
        style={{
          background: "#ffffff",
          border: `1px solid ${CARD_BORDER}`,
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <div
          className="flex flex-wrap items-center justify-between"
          style={{
            padding: "20px 28px",
            borderBottom: `1px solid ${ROW_BORDER}`,
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>Members</div>
            <div style={{ fontSize: 12.5, color: LIGHT_MUTED, marginTop: 3 }}>
              Editors generate + edit. Admins also manage team and billing.
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 12.5, color: MUTED, fontWeight: 600 }}>
              {seatsUsed} of {seatsLimit} seats used
            </div>
            <div
              style={{
                width: 110,
                height: 5,
                borderRadius: 99,
                background: "#eef1f6",
                marginTop: 6,
                marginLeft: "auto",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${seatPct}%`,
                  height: "100%",
                  borderRadius: 99,
                  background: seatPct >= 80 ? "#C9952B" : ACCENT,
                }}
              />
            </div>
          </div>
        </div>

        {/* Invite row on subtle canvas strip */}
        {canManageInvites ? (
          <div
            style={{
              background: "#f6f8fc",
              borderBottom: `1px solid ${ROW_BORDER}`,
              padding: "18px 28px",
            }}
          >
            <InviteMemberForm seatsRemaining={seatsRemaining} capacity={bannerCapacity} />
          </div>
        ) : null}

        {/* Member rows */}
        {members.length === 0 ? (
          <div
            style={{
              padding: "32px 28px",
              textAlign: "center",
              fontSize: 12.5,
              color: LIGHT_MUTED,
            }}
          >
            No members yet — invite teammates above.
          </div>
        ) : (
          <div>
            {members.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                isSelf={m.id === viewerMemberId}
                viewerRole={viewerRole}
              />
            ))}
          </div>
        )}

        {/* Empty-seats row — dashed placeholder */}
        {seatsRemaining > 0 && seatsLimit > 1 ? (
          <div
            className="flex flex-wrap items-center"
            style={{
              gap: 12,
              padding: "14px 28px",
              borderTop: `1px dashed ${CARD_BORDER}`,
              color: LIGHT_MUTED,
            }}
          >
            <div
              className="flex-shrink-0"
              style={{
                width: 36,
                height: 36,
                borderRadius: 999,
                border: `1.5px dashed ${LIGHT_MUTED}`,
              }}
            />
            <div style={{ fontSize: 13 }}>
              {seatsRemaining === 1 ? "1 open seat" : `${seatsRemaining} open seats`} on {plan} —
              {canManageInvites ? <> invite a teammate above or </> : " ask an admin to "}
              <a
                href="/settings/billing"
                className="no-underline"
                style={{ color: ACCENT, fontWeight: 600 }}
              >
                compare plans
              </a>
              .
            </div>
          </div>
        ) : null}
      </div>

      {/* Pending invites — separate card so revocation actions have their own space */}
      {pendingInvites.length > 0 ? (
        <div
          style={{
            background: "#ffffff",
            border: `1px solid ${CARD_BORDER}`,
            borderRadius: 12,
            padding: "20px 28px",
            marginTop: 16,
          }}
        >
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>Pending invites</div>
            <div style={{ fontSize: 12.5, color: LIGHT_MUTED, marginTop: 3 }}>
              {pendingInvites.length} waiting to be accepted · expire after 14 days
            </div>
          </div>
          <div>
            {pendingInvites.map((inv) => (
              <PendingInviteRow key={inv.id} invite={inv} />
            ))}
          </div>
        </div>
      ) : null}

      {/* Recent team activity */}
      {isLiveDb() ? (
        <div
          style={{
            background: "#ffffff",
            border: `1px solid ${CARD_BORDER}`,
            borderRadius: 12,
            padding: "22px 28px",
            marginTop: 16,
          }}
        >
          <div className="flex items-baseline justify-between">
            <div style={{ fontSize: 16, fontWeight: 700, color: INK }}>Recent team activity</div>
            <span
              style={{
                fontFamily: "var(--font-revamp-mono)",
                fontSize: 11,
                color: LIGHT_MUTED,
                letterSpacing: "0.06em",
              }}
            >
              AUDIT TRAIL
            </span>
          </div>
          <div style={{ marginTop: 14 }}>
            <MemberActivityFeed items={memberTransitions} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
