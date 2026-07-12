import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipsList } from "@/components/episodes/clips-list";
import { isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";
import { listClipsForEpisode } from "@/server/db/video-clips";
import { resolveClipSource } from "@/server/media/clip-source";

/**
 * Q1 wk5 — clip management page.
 *
 * Route: /episodes/[id]/clips
 *
 * Loads all VideoClip rows for the episode, together with the source
 * readiness flags (sourceVideoUrl + transcriptWords) so the empty state
 * can either offer "Generate clips" or explain why the episode isn't
 * ready yet.
 *
 * The list is a client component (`components/episodes/clips-list.tsx`)
 * because it polls for state transitions when clips are in flight —
 * cheaper than adding another SSE stream just for the clips view.
 */
export default async function EpisodeClipsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: episodeId } = await params;
  const tenant = await resolveTenantContext();

  if (!isLiveDb()) {
    // Sample-data mode — no clips ever exist; render the "not ready"
    // empty state so the route doesn't 404 during dev-without-DB.
    return (
      <ClipsPageShell episodeId={episodeId} episodeTitle="Sample episode">
        <ClipsList
          episodeId={episodeId}
          clips={[]}
          isReady={false}
          notReadyReason="Sample-data mode — clip generation needs a live database."
          readOnly
        />
      </ClipsPageShell>
    );
  }

  const episode = await prisma.episode.findFirst({
    where: {
      id: episodeId,
      show: { client: { agencyId: tenant.agencyId } },
    },
    select: {
      id: true,
      title: true,
      source: true,
      sourceVideoUrl: true,
      audioUrl: true,
      transcriptWords: true,
    },
  });
  if (!episode) notFound();

  const clips = await listClipsForEpisode(tenant.agencyId, episodeId);

  const source = resolveClipSource(episode);
  const isReady = Boolean(source && episode.transcriptWords);
  const notReadyReason = !source
    ? "This episode has no source file. Clip generation needs an uploaded video/audio file or a YouTube import."
    : !episode.transcriptWords
      ? "This episode was transcribed before the clip pipeline shipped. Re-transcribe to enable clips."
      : null;
  const readOnly = tenant.impersonation?.mode === "read";

  // Serialize Date fields for the client component — plain JSON.
  const clipsForClient = clips.map((c) => ({
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
  }));

  return (
    <ClipsPageShell episodeId={episodeId} episodeTitle={episode.title}>
      <ClipsList
        episodeId={episodeId}
        clips={clipsForClient}
        isReady={isReady}
        notReadyReason={notReadyReason}
        readOnly={readOnly}
      />
    </ClipsPageShell>
  );
}

function ClipsPageShell({
  episodeId,
  episodeTitle,
  children,
}: {
  episodeId: string;
  episodeTitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
      <div className="mb-6 flex flex-col gap-1">
        <nav className="text-muted-2 text-[12.5px]">
          <Link href="/episodes" className="hover:text-ink">
            Episodes
          </Link>
          <span className="mx-1.5">/</span>
          <Link href={`/episodes/${episodeId}`} className="hover:text-ink">
            {episodeTitle}
          </Link>
          <span className="mx-1.5">/</span>
          <span className="text-ink">Clips</span>
        </nav>
        <h1 className="font-display text-ink text-[22px] font-semibold">Short-form clips</h1>
        <p className="text-muted-2 max-w-2xl text-[13.5px] leading-[1.6]">
          Vertical 9:16 clips generated from the strongest moments in this episode. Ready to publish
          to Reels, Shorts, and TikTok.
        </p>
      </div>
      {children}
    </div>
  );
}
