import { auth, currentUser } from "@clerk/nextjs/server";
import { InviteStatus, MemberRole } from "@prisma/client";
import { notFound } from "next/navigation";
import { AcceptInviteCard } from "@/components/onboarding/accept-invite-card";
import { getInviteByToken } from "@/server/db/invites";
import { isLiveDb } from "@/server/data/source";

export const dynamic = "force-dynamic";

type InviteViewState =
  | { kind: "valid"; agencyName: string; roleLabel: string; email: string }
  | { kind: "expired" }
  | { kind: "revoked" }
  | { kind: "already-accepted" }
  | { kind: "not-found" };

export default async function InviteAcceptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (!isLiveDb()) {
    return (
      <AcceptInviteCard
        state={{ kind: "not-found" }}
        token={token}
        signedInEmail={null}
        autoAccept={false}
      />
    );
  }

  const invite = await getInviteByToken(token);
  let view: InviteViewState;
  if (!invite) {
    view = { kind: "not-found" };
  } else if (invite.status === InviteStatus.EXPIRED) {
    view = { kind: "expired" };
  } else if (invite.status === InviteStatus.REVOKED) {
    view = { kind: "revoked" };
  } else if (invite.status === InviteStatus.ACCEPTED) {
    view = { kind: "already-accepted" };
  } else {
    view = {
      kind: "valid",
      agencyName: invite.agency.name,
      roleLabel: invite.role === MemberRole.ADMIN ? "Admin" : "Editor",
      email: invite.email,
    };
  }

  // If the visitor is already signed in with the matching email, we can
  // auto-accept (the accept page just shows a "Joining…" state and then
  // redirects). Otherwise the card guides them to sign up / sign in.
  const { userId } = await auth();
  const signedInUser = userId ? await currentUser().catch(() => null) : null;
  const signedInEmail = signedInUser?.primaryEmailAddress?.emailAddress ?? null;
  const autoAccept =
    view.kind === "valid" &&
    signedInEmail !== null &&
    signedInEmail.toLowerCase() === view.email.toLowerCase();

  if (!token) notFound();

  return (
    <AcceptInviteCard
      state={view}
      token={token}
      signedInEmail={signedInEmail}
      autoAccept={autoAccept}
    />
  );
}
