import { redirect } from "next/navigation";
import { listShowsForUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";

/**
 * /voice has no content of its own — it just picks a default show and
 * forwards to that show's voice profile. If the agency has no shows yet,
 * route to /shows so they can add one.
 */
export default async function VoiceIndexPage() {
  const tenant = await resolveTenantContext();
  const shows = await listShowsForUI(tenant);
  const first = shows[0];
  if (!first) redirect("/shows");
  redirect(`/voice/${first.key}`);
}
