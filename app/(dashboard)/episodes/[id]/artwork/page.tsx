import { notFound } from "next/navigation";
import { ArtworkStrip } from "@/components/episodes/artwork-strip";
import { ArtworkTrigger } from "@/components/episodes/artwork-trigger";
import { isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";

/**
 * Q1 feature #4 — dedicated artwork tab. Shows the three variants
 * (16:9, 1:1, 9:16), the concept Claude picked, and a Generate /
 * Regenerate CTA.
 */
export default async function EpisodeArtworkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: episodeId } = await params;
  const tenant = await resolveTenantContext();

  if (!isLiveDb()) {
    return (
      <ArtworkTab episodeId={episodeId} artwork={null} transcriptTooShort={false} sampleMode />
    );
  }

  const row = await prisma.episode.findFirst({
    where: { id: episodeId, show: { client: { agencyId: tenant.agencyId } } },
    select: {
      transcript: true,
      heroImageUrl: true,
      squareCoverUrl: true,
      verticalCoverUrl: true,
      artworkConcept: true,
    },
  });
  if (!row) notFound();

  const concept =
    row.artworkConcept &&
    typeof row.artworkConcept === "object" &&
    !Array.isArray(row.artworkConcept)
      ? (row.artworkConcept as Record<string, unknown>)
      : null;

  return (
    <ArtworkTab
      episodeId={episodeId}
      artwork={{
        heroImageUrl: row.heroImageUrl,
        squareCoverUrl: row.squareCoverUrl,
        verticalCoverUrl: row.verticalCoverUrl,
        concept,
      }}
      transcriptTooShort={!row.transcript || row.transcript.trim().length < 200}
    />
  );
}

function ArtworkTab({
  episodeId,
  artwork,
  transcriptTooShort,
  sampleMode = false,
}: {
  episodeId: string;
  artwork: {
    heroImageUrl: string | null;
    squareCoverUrl: string | null;
    verticalCoverUrl: string | null;
    concept: Record<string, unknown> | null;
  } | null;
  transcriptTooShort: boolean;
  sampleMode?: boolean;
}) {
  const anyUrl =
    artwork && (artwork.heroImageUrl || artwork.squareCoverUrl || artwork.verticalCoverUrl);
  const concept = artwork?.concept ?? null;
  const conceptShape = concept as {
    subject?: string;
    mood?: string;
    palette?: string;
    style?: string;
    textOverlay?: string;
  } | null;

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-14 sm:px-6 md:px-7 md:pb-[60px]">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-ink text-[18px] font-semibold">Hero artwork</h2>
          <p className="text-muted-2 mt-1 max-w-2xl text-[13px] leading-[1.6]">
            Three aspect ratios generated with Cloudflare Workers AI (Flux). One visual concept
            drives all three so they read as a set — same palette, same mood, different frames.
          </p>
        </div>
        {!sampleMode && !transcriptTooShort && <ArtworkTrigger episodeId={episodeId} />}
      </div>

      {sampleMode && (
        <p className="text-muted-2 text-[13px]">
          Sample-data mode — artwork generation needs a live database.
        </p>
      )}

      {!sampleMode && transcriptTooShort && (
        <div className="border-border bg-surface rounded-2xl border p-6">
          <div className="font-display text-ink text-[15px] font-semibold">
            Not ready for artwork
          </div>
          <p className="text-muted-2 mt-1.5 text-[13px] leading-[1.6]">
            The transcript is too short to derive a visual concept. Try again after transcription
            completes.
          </p>
        </div>
      )}

      {!sampleMode && !transcriptTooShort && !anyUrl && (
        <div className="border-border bg-surface rounded-2xl border p-8 text-center">
          <div className="font-display text-ink text-[16px] font-semibold">
            No artwork generated yet
          </div>
          <p className="text-muted-2 mx-auto mt-1.5 max-w-md text-[13px] leading-[1.6]">
            Claude picks a visual concept from the transcript, then Flux renders all three aspect
            ratios. Takes about 15 seconds.
          </p>
        </div>
      )}

      {anyUrl && artwork && (
        <>
          <ArtworkStrip
            heroImageUrl={artwork.heroImageUrl}
            squareCoverUrl={artwork.squareCoverUrl}
            verticalCoverUrl={artwork.verticalCoverUrl}
            concept={conceptShape}
          />
          {conceptShape && <ConceptDetails concept={conceptShape} />}
        </>
      )}
    </div>
  );
}

function ConceptDetails({
  concept,
}: {
  concept: {
    subject?: string;
    mood?: string;
    palette?: string;
    style?: string;
    textOverlay?: string;
  };
}) {
  const rows: Array<[string, string | undefined]> = [
    ["Subject", concept.subject],
    ["Mood", concept.mood],
    ["Palette", concept.palette],
    ["Style", concept.style],
    ["Text overlay", concept.textOverlay || undefined],
  ];
  const visible = rows.filter(([, value]) => value && value.trim().length > 0);
  if (visible.length === 0) return null;

  return (
    <div className="border-border bg-surface mt-4 rounded-2xl border p-4">
      <h3 className="font-display text-ink mb-3 text-[13px] font-semibold">Visual concept</h3>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-[140px_1fr]">
        {visible.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-2 text-[12px] font-semibold sm:pt-0.5">{label}</dt>
            <dd className="text-ink text-[13px] leading-[1.5]">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
