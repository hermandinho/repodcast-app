import type { WebhookEvent } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { Webhook } from "svix";
import {
  deleteAgencyByClerkOrgId,
  deleteAllMembersForClerkUser,
  deleteMemberByClerkIds,
  refreshMembersForClerkUser,
  upsertAgencyFromClerkOrg,
  upsertMemberFromClerkMembership,
} from "@/server/db/auth-sync";
import { captureWebhookFailure } from "@/server/observability/sentry";

// Webhook endpoints must never be cached.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[clerk-webhook] CLERK_WEBHOOK_SECRET is not set");
    return new Response("server misconfigured", { status: 500 });
  }

  const headerList = await headers();
  const svixId = headerList.get("svix-id");
  const svixTimestamp = headerList.get("svix-timestamp");
  const svixSignature = headerList.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("missing svix headers", { status: 400 });
  }

  // Read the raw body — svix verifies against the exact bytes.
  const payload = await req.text();

  let event: WebhookEvent;
  try {
    event = new Webhook(secret).verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as WebhookEvent;
  } catch (err) {
    console.warn("[clerk-webhook] signature verification failed", err);
    return new Response("invalid signature", { status: 400 });
  }

  try {
    await dispatch(event);
  } catch (err) {
    // Log and return 500 so Clerk will retry — we'd rather process twice
    // than silently drop a sync event.
    console.error("[clerk-webhook] handler failed", { type: event.type, err });
    captureWebhookFailure("clerk_webhook", err, { eventType: event.type });
    return new Response("handler error", { status: 500 });
  }

  return new Response(null, { status: 204 });
}

async function dispatch(event: WebhookEvent): Promise<void> {
  switch (event.type) {
    case "organization.created":
    case "organization.updated":
      await upsertAgencyFromClerkOrg(event.data);
      return;

    case "organization.deleted":
      if (event.data.id) await deleteAgencyByClerkOrgId(event.data.id);
      return;

    case "organizationMembership.created":
    case "organizationMembership.updated":
      await upsertMemberFromClerkMembership(event.data);
      return;

    case "organizationMembership.deleted": {
      const orgId = event.data.organization?.id;
      const userId = event.data.public_user_data?.user_id;
      if (orgId && userId) await deleteMemberByClerkIds(orgId, userId);
      return;
    }

    case "user.updated":
      await refreshMembersForClerkUser(event.data);
      return;

    case "user.deleted":
      if (event.data.id) await deleteAllMembersForClerkUser(event.data.id);
      return;

    // Other events (session.created, email.created, etc.) we don't yet care about.
    default:
      return;
  }
}
