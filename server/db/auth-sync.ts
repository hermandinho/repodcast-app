import type {
  DeletedObjectJSON,
  OrganizationJSON,
  OrganizationMembershipJSON,
  UserJSON,
} from "@clerk/nextjs/server";
import { clerkClient } from "@clerk/nextjs/server";
import { MemberRole } from "@prisma/client";
import { sendWelcomeEmail } from "@/server/email/send";
import { prisma } from "./client";

/**
 * Map Clerk's organization role string to our MemberRole enum.
 * Clerk ships "org:admin" and "org:member" by default; custom roles fall
 * back to EDITOR. The creator of the org is "admin" on Clerk's side and is
 * promoted to OWNER on a separate path (see TODO below).
 */
export function mapClerkRoleToMemberRole(clerkRole: string): MemberRole {
  if (clerkRole === "admin" || clerkRole === "org:admin") return MemberRole.ADMIN;
  // "org:member", custom roles, etc.
  return MemberRole.EDITOR;
}

// ============================================================
// Agency ⇔ Clerk Organization
// ============================================================

export async function upsertAgencyFromClerkOrg(org: OrganizationJSON) {
  return prisma.agency.upsert({
    where: { clerkOrgId: org.id },
    create: {
      clerkOrgId: org.id,
      name: org.name,
    },
    update: {
      name: org.name,
    },
  });
}

export async function deleteAgencyByClerkOrgId(clerkOrgId: string) {
  // Cascade handles Members, Clients, Episodes, etc.
  await prisma.agency.deleteMany({ where: { clerkOrgId } });
}

// ============================================================
// Member ⇔ Clerk OrganizationMembership
// ============================================================

export async function upsertMemberFromClerkMembership(membership: OrganizationMembershipJSON) {
  const agency = await prisma.agency.findUnique({
    where: { clerkOrgId: membership.organization.id },
  });
  if (!agency) {
    // Clerk can fire OrgMembership before the Org event in race conditions.
    // Create the agency lazily to avoid losing the event.
    const created = await upsertAgencyFromClerkOrg(membership.organization);
    return doUpsertMember(created.id, membership);
  }
  return doUpsertMember(agency.id, membership);
}

async function doUpsertMember(agencyId: string, membership: OrganizationMembershipJSON) {
  const clerkUserId = membership.public_user_data?.user_id;
  if (!clerkUserId) {
    throw new Error("OrganizationMembership payload is missing public_user_data.user_id");
  }
  const role = mapClerkRoleToMemberRole(membership.role);

  // Pull canonical email/name from the User record. publicUserData on the
  // membership payload lacks email.
  const client = await clerkClient();
  const user = await client.users.getUser(clerkUserId);
  const email = primaryEmail(user) ?? `${clerkUserId}@clerk.local`;
  const name = displayName(user);

  // Detect "first member of this agency" BEFORE the upsert so we can fire
  // a welcome email exactly once. We treat the first synced membership as
  // the welcome trigger (matches the Clerk org-creation flow).
  const existing = await prisma.member.findUnique({
    where: { agencyId_clerkUserId: { agencyId, clerkUserId } },
    select: { id: true },
  });
  const isFirstMember = !existing && (await prisma.member.count({ where: { agencyId } })) === 0;

  const member = await prisma.member.upsert({
    where: {
      agencyId_clerkUserId: { agencyId, clerkUserId },
    },
    create: { agencyId, clerkUserId, role, email, name },
    update: { role, email, name },
  });

  if (isFirstMember && email && !email.endsWith("@clerk.local")) {
    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
      select: { name: true },
    });
    // Fire-and-forget — never block the webhook on email delivery.
    void sendWelcomeEmail(email, {
      firstName: name?.split(" ")[0] ?? "there",
      agencyName: agency?.name ?? "Your agency",
      dashboardUrl: dashboardBaseUrl(),
    });
  }

  return member;
}

function dashboardBaseUrl(): string {
  return (
    (process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")) +
    "/dashboard"
  );
}

export async function deleteMemberByClerkIds(clerkOrgId: string, clerkUserId: string) {
  const agency = await prisma.agency.findUnique({ where: { clerkOrgId } });
  if (!agency) return;
  await prisma.member.deleteMany({
    where: { agencyId: agency.id, clerkUserId },
  });
}

export async function deleteAllMembersForClerkUser(clerkUserId: string) {
  await prisma.member.deleteMany({ where: { clerkUserId } });
}

// ============================================================
// User refresh (when user.updated fires)
// ============================================================

export async function refreshMembersForClerkUser(user: UserJSON) {
  const email = primaryEmail(user) ?? `${user.id}@clerk.local`;
  const name = displayName(user);
  await prisma.member.updateMany({
    where: { clerkUserId: user.id },
    data: { email, name },
  });
}

// ============================================================
// Helpers
// ============================================================

type ClerkUserShape = {
  emailAddresses?: { id: string; emailAddress: string }[];
  email_addresses?: { id: string; email_address: string }[];
  primaryEmailAddressId?: string | null;
  primary_email_address_id?: string | null;
  firstName?: string | null;
  first_name?: string | null;
  lastName?: string | null;
  last_name?: string | null;
};

function primaryEmail(user: ClerkUserShape): string | null {
  // The Backend SDK returns camelCase; webhook JSON is snake_case.
  const list = user.emailAddresses ?? user.email_addresses ?? [];
  const primaryId = user.primaryEmailAddressId ?? user.primary_email_address_id;
  const primary = list.find((e) => e.id === primaryId);
  const fallback = list[0];
  const picked = primary ?? fallback;
  if (!picked) return null;
  return (
    ("emailAddress" in picked && picked.emailAddress) ||
    ("email_address" in picked && picked.email_address) ||
    null
  );
}

function displayName(user: ClerkUserShape): string | null {
  const first = user.firstName ?? user.first_name ?? "";
  const last = user.lastName ?? user.last_name ?? "";
  const joined = `${first} ${last}`.trim();
  return joined.length > 0 ? joined : null;
}

export { primaryEmail, displayName };

// ============================================================
// Deleted object helper (Clerk sends a thin DeletedObjectJSON shape)
// ============================================================

export function deletedObjectId(payload: DeletedObjectJSON): string {
  return payload.id ?? "";
}
