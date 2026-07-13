import { notFound } from "next/navigation";
import { RegenQuotaMeter } from "@/components/billing/regen-quota-meter";
import { ClipsList } from "@/components/episodes/clips-list";
import { loadRegenQuotasForUI } from "@/server/billing/limits";
import { isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";
import { listClipsForEpisode } from "@/server/db/video-clips";
import { resolveClipSource } from "@/server/media/clip-source";

/**
 * Q1 wk5 — clip management tab. Renders inside the shared episode
 * layout, which owns the breadcrumb + title + tab bar.
 */
export default async function EpisodeClipsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: episodeId } = await params;
  const tenant = await resolveTenantContext();

  if (!isLiveDb()) {
    return (
      <TabIntro
        title="Short-form clips"
        description="Vertical 9:16 clips generated from the strongest moments in this episode."
      >
        <ClipsList
          episodeId={episodeId}
          clips={[]}
          isReady={false}
          notReadyReason="Sample-data mode — clip generation needs a live database."
          readOnly
          plan={null}
        />
      </TabIntro>
    );
  }

  const episode = await prisma.episode.findFirst({
    where: { id: episodeId, show: { client: { agencyId: tenant.agencyId } } },
    select: {
      id: true,
      source: true,
      sourceVideoUrl: true,
      audioUrl: true,
      transcriptWords: true,
    },
  });
  if (!episode) notFound();

  const [clips, regenQuotas] = await Promise.all([
    listClipsForEpisode(tenant.agencyId, episodeId),
    loadRegenQuotasForUI(tenant.agencyId),
  ]);
  const source = resolveClipSource(episode);
  const isReady = Boolean(source && episode.transcriptWords);
  const notReadyReason = !source
    ? "This episode has no source file. Clip generation needs an uploaded video/audio file or a YouTube import."
    : !episode.transcriptWords
      ? "This episode was transcribed before the clip pipeline shipped. Re-transcribe to enable clips."
      : null;
  const readOnly = tenant.impersonation?.mode === "read";

  return (
    <TabIntro
      title="Short-form clips"
      description="Vertical 9:16 clips generated from the strongest moments in this episode. Ready to publish to Reels, Shorts, and TikTok."
    >
      <RegenQuotaMeter
        kind="clip"
        plan={regenQuotas.plan}
        quota={regenQuotas.clip}
        className="mb-4"
      />
      <ClipsList
        episodeId={episodeId}
        clips={clips.map((c) => ({
          id: c.id,
          startMs: c.startMs,
          endMs: c.endMs,
          score: c.score,
          hookLine: c.hookLine,
          status: c.status,
          renderedUrl: c.renderedUrl,
          posterUrl: c.posterUrl,
          renderError: c.renderError,
          createdAt: c.createdAt.toISOString(),
        }))}
        isReady={isReady}
        notReadyReason={notReadyReason}
        readOnly={readOnly}
        plan={regenQuotas.plan}
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
  // Content is comfortably readable up to ~1400 px; wider than that
  // and the clip grid gets sparse. Left/right padding matches the
  // outputs tab and the shared header so column edges align.
  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-14 sm:px-6 md:px-7 md:pb-[60px]">
      <div className="mb-6">
        <h2 className="font-display text-ink text-[18px] font-semibold">{title}</h2>
        <p className="text-muted-2 mt-1 max-w-2xl text-[13px] leading-[1.6]">{description}</p>
      </div>
      {children}
    </div>
  );
}
