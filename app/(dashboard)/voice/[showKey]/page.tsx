import { notFound } from "next/navigation";
import { VoiceView } from "@/components/voice/voice-view";
import { getVoiceProfileForUI } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";

export default async function VoiceProfilePage({
  params,
}: {
  params: Promise<{ showKey: string }>;
}) {
  const { showKey } = await params;
  const tenant = await resolveTenantContext();
  const result = await getVoiceProfileForUI(tenant, showKey);
  if (!result) notFound();

  return <VoiceView show={result.show} profile={result.profile} progress={result.progress} />;
}
