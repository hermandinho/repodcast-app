import Link from "next/link";
import { notFound } from "next/navigation";
import { AudiogramsList } from "@/components/episodes/audiograms-list";
import { isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";

/**
 * Q1 feature #5 — audiogram management page.
 *
 * Route: /episodes/[id]/audiograms
 *
 * Lists every current GeneratedOutput on the episode with its audiogram
 * state. Mirrors the /clips page shape: server-loaded initial state,
 * client-side polling while any audiogram is in flight, per-row
 * generate/retry/preview affordances.
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
      <Shell episodeId={episodeId} episodeTitle="Sample episode">
        <AudiogramsList
          episodeId={episodeId}
          outputs={[]}
          isReady={false}
          notReadyReason="Sample-data mode — audiograms need a live database."
          readOnly
        />
      </Shell>
    );
  }

  const episode = await prisma.episode.findFirst({
    where: { id: episodeId, show: { client: { agencyId: tenant.agencyId } } },
    select: {
      id: true,
      title: true,
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
    ? "This episode has no audio file. Audiograms need source audio (uploaded audio, RSS enclosure, or a re-transcribed YouTube episode)."
    : !episode.transcriptWords
      ? "This episode was transcribed before the audiogram pipeline shipped. Re-transcribe to enable audiograms."
      : null;
  const readOnly = tenant.impersonation?.mode === "read";

  return (
    <Shell episodeId={episodeId} episodeTitle={episode.title}>
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
    </Shell>
  );
}

function Shell({
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
          <span className="text-ink">Audiograms</span>
        </nav>
        <h1 className="font-display text-ink text-[22px] font-semibold">Audiograms</h1>
        <p className="text-muted-2 max-w-2xl text-[13.5px] leading-[1.6]">
          Waveform videos with burnt-in captions. Attach to social posts on platforms Buffer can
          carry the video for, or download and upload manually.
        </p>
      </div>
      {children}
    </div>
  );
}
