import { notFound } from "next/navigation";
import { AudiogramsList } from "@/components/episodes/audiograms-list";
import { isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";

/**
 * Q1 feature #5 — audiogram management tab. Renders inside the shared
 * episode layout, which owns the breadcrumb + title + tab bar.
 */
export default async function EpisodeAudiogramsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: episodeId } = await params;
  const tenant = await resolveTenantContext();

  if (!isLiveDb()) {
    return (
      <TabIntro
        title="Audiograms"
        description="Waveform videos with burnt-in captions, per social output."
      >
        <AudiogramsList
          episodeId={episodeId}
          outputs={[]}
          isReady={false}
          notReadyReason="Sample-data mode — audiograms need a live database."
          readOnly
        />
      </TabIntro>
    );
  }

  const episode = await prisma.episode.findFirst({
    where: { id: episodeId, show: { client: { agencyId: tenant.agencyId } } },
    select: {
      id: true,
      audioUrl: true,
      transcriptWords: true,
      outputs: {
        where: { supersededAt: null },
        orderBy: [{ platform: "asc" }, { version: "desc" }],
        select: {
          id: true,
          platform: true,
          content: true,
          audiogramStatus: true,
          audiogramUrl: true,
          audiogramPosterUrl: true,
          audiogramError: true,
          audiogramStartMs: true,
          audiogramEndMs: true,
          audiogramAspect: true,
        },
      },
    },
  });
  if (!episode) notFound();

  const isReady = Boolean(episode.audioUrl && episode.transcriptWords);
  const notReadyReason = !episode.audioUrl
    ? "This episode has no audio file. Audiograms need source audio."
    : !episode.transcriptWords
      ? "This episode was transcribed before the audiogram pipeline shipped. Re-transcribe to enable audiograms."
      : null;
  const readOnly = tenant.impersonation?.mode === "read";

  return (
    <TabIntro
      title="Audiograms"
      description="Waveform videos with burnt-in captions. Attach to social posts on platforms that carry video, or download and upload manually."
    >
      <AudiogramsList
        episodeId={episodeId}
        outputs={episode.outputs.map((o) => ({
          id: o.id,
          platform: o.platform,
          contentPreview: o.content.slice(0, 200),
          audiogramStatus: o.audiogramStatus,
          audiogramUrl: o.audiogramUrl,
          audiogramPosterUrl: o.audiogramPosterUrl,
          audiogramError: o.audiogramError,
          audiogramStartMs: o.audiogramStartMs,
          audiogramEndMs: o.audiogramEndMs,
          audiogramAspect: o.audiogramAspect,
        }))}
        isReady={isReady}
        notReadyReason={notReadyReason}
        readOnly={readOnly}
      />
    </TabIntro>
  );
}

function TabIntro({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="mb-6">
        <h2 className="font-display text-ink text-[18px] font-semibold">{title}</h2>
        <p className="text-muted-2 mt-1 max-w-2xl text-[13px] leading-[1.6]">{description}</p>
      </div>
      {children}
    </>
  );
}
