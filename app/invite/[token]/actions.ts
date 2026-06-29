"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { z } from "zod";
import { ValidationError } from "@/server/auth/errors";
import { acceptInvite } from "@/server/db/invites";
import { recordMemberTransition } from "@/server/db/member-transitions";
import { isLiveDb } from "@/server/data/source";

export type AcceptResult =
  | { ok: true; data: { agencyId: string } }
  | {
      ok: false;
      reason:
        | "not-signed-in"
        | "not-found"
        | "expired"
        | "revoked"
        | "already-accepted"
        | "email-mismatch"
        | "not-configured";
    };

const acceptSchema = z.object({ token: z.string().min(1) });

export async function acceptInviteAction(raw: unknown): Promise<AcceptResult> {
  const parsed = acceptSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError("Invalid accept input", parsed.error.issues);
  }
  const { token } = parsed.data;

  if (!isLiveDb()) {
    return { ok: false, reason: "not-configured" };
  }

  const { userId } = await auth();
  if (!userId) return { ok: false, reason: "not-signed-in" };

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  if (!email) {
    return { ok: false, reason: "email-mismatch" };
  }
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || null;

  const result = await acceptInvite(token, {
    clerkUserId: userId,
    email,
    name,
  });
  if (!result.ok) return { ok: false, reason: result.reason };

  // Self-action: the new member just accepted their own invite. `byMemberId`
  // is the accepted Member itself so the feed reads "Alice joined as Editor"
  // (we render no actor on self-actions to keep the copy natural).
  await recordMemberTransition(result.agencyId, {
    kind: "INVITE_ACCEPTED",
    byMemberId: result.memberId,
    targetMemberId: result.memberId,
    email,
  });

  return { ok: true, data: { agencyId: result.agencyId } };
}
