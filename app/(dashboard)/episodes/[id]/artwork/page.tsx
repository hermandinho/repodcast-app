import { notFound } from "next/navigation";
import { RegenQuotaMeter, type RegenQuota } from "@/components/billing/regen-quota-meter";
import { ArtworkTrigger } from "@/components/episodes/artwork-trigger";
import type { Plan } from "@/lib/enums";
import { loadRegenQuotasForUI } from "@/server/billing/limits";
import { isLiveDb } from "@/server/data/source";
import { resolveTenantContext } from "@/server/data/tenant";
import { prisma } from "@/server/db/client";

/**
 * Episode artwork tab.
 *
 * Two-section "profile" layout: the publisher's original image sits at
 * the top with its own metadata rail, then the AI-generated variants (or
 * their empty state) sit below. The two coexist by design — generating
 * AI variants never overwrites the publisher-supplied art, and clearing
 * the AI variants leaves the original untouched.
 */
export default async function EpisodeArtworkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: episodeId } = await params;
  const tenant = await resolveTenantContext();

  if (!isLiveDb()) {
    return (
      <ArtworkTab episodeId={episodeId} artwork={null} transcriptTooShort={false} sampleMode />
    );
  }

  const [row, regenQuotas] = await Promise.all([
    prisma.episode.findFirst({
      where: { id: episodeId, show: { client: { agencyId: tenant.agencyId } } },
      select: {
        transcript: true,
        sourceImageUrl: true,
        heroImageUrl: true,
        squareCoverUrl: true,
        verticalCoverUrl: true,
        artworkConcept: true,
      },
    }),
    loadRegenQuotasForUI(tenant.agencyId),
  ]);
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
        sourceImageUrl: row.sourceImageUrl,
        heroImageUrl: row.heroImageUrl,
        squareCoverUrl: row.squareCoverUrl,
        verticalCoverUrl: row.verticalCoverUrl,
        concept,
      }}
      transcriptTooShort={!row.transcript || row.transcript.trim().length < 200}
      regenQuota={regenQuotas.artwork}
      plan={regenQuotas.plan}
    />
  );
}

type Concept = {
  subject?: string;
  mood?: string;
  palette?: string;
  style?: string;
  textOverlay?: string;
};

function ArtworkTab({
  episodeId,
  artwork,
  transcriptTooShort,
  regenQuota = null,
  plan = null,
  sampleMode = false,
}: {
  episodeId: string;
  artwork: {
    sourceImageUrl: string | null;
    heroImageUrl: string | null;
    squareCoverUrl: string | null;
    verticalCoverUrl: string | null;
    concept: Record<string, unknown> | null;
  } | null;
  transcriptTooShort: boolean;
  regenQuota?: RegenQuota | null;
  plan?: Plan | null;
  sampleMode?: boolean;
}) {
  const sourceImageUrl = artwork?.sourceImageUrl ?? null;
  const heroImageUrl = artwork?.heroImageUrl ?? null;
  const squareCoverUrl = artwork?.squareCoverUrl ?? null;
  const verticalCoverUrl = artwork?.verticalCoverUrl ?? null;
  const anyAiUrl = heroImageUrl || squareCoverUrl || verticalCoverUrl;
  const anyArtwork = sourceImageUrl || anyAiUrl;
  const concept = (artwork?.concept ?? null) as Concept | null;

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-14 sm:px-6 md:px-7 md:pb-[60px]">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-ink text-[18px] font-semibold">Artwork</h2>
          <p className="text-muted-2 mt-1 max-w-2xl text-[13px] leading-[1.6]">
            The publisher&apos;s original image sits alongside AI-generated variants — same episode,
            different frames. Generating variants never overwrites the original.
          </p>
        </div>
        {!sampleMode && !transcriptTooShort && (
          <ArtworkTrigger
            episodeId={episodeId}
            hasArtwork={Boolean(anyAiUrl)}
            artworkSignature={heroImageUrl ?? squareCoverUrl ?? verticalCoverUrl ?? null}
          />
        )}
      </div>

      {plan && regenQuota && (
        <RegenQuotaMeter kind="artwork" plan={plan} quota={regenQuota} className="mb-4" />
      )}

      {sampleMode && (
        <p className="text-muted-2 text-[13px]">
          Sample-data mode — artwork generation needs a live database.
        </p>
      )}

      {sourceImageUrl && <PublisherArtworkPanel url={sourceImageUrl} />}

      {!sampleMode && (
        <AiVariantsSection
          transcriptTooShort={transcriptTooShort}
          anyAiUrl={Boolean(anyAiUrl)}
          hasPublisherArt={Boolean(sourceImageUrl)}
          heroImageUrl={heroImageUrl}
          squareCoverUrl={squareCoverUrl}
          verticalCoverUrl={verticalCoverUrl}
          concept={concept}
        />
      )}

      {!sampleMode && !anyArtwork && transcriptTooShort && (
        <EmptyCard
          title="Not ready for artwork"
          body="The transcript is too short to derive a visual concept. Try again after transcription completes."
        />
      )}
    </div>
  );
}

// ---- Sections -----------------------------------------------------------

function PublisherArtworkPanel({ url }: { url: string }) {
  return (
    <section
      className="border-border bg-surface mb-5 overflow-hidden rounded-2xl border"
      aria-labelledby="publisher-artwork-heading"
    >
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="bg-surface-3 relative aspect-square w-full overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="Publisher artwork"
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
        <div className="flex flex-col justify-between gap-5 p-5 md:p-6">
          <div>
            <span
              className="rounded-pill inline-block px-2.5 py-1 font-sans text-[10.5px] font-semibold tracking-[0.06em] uppercase"
              style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
            >
              From RSS feed
            </span>
            <h3
              id="publisher-artwork-heading"
              className="font-display text-ink mt-3 text-[16px] font-semibold"
            >
              Publisher artwork
            </h3>
            <p className="text-muted-2 mt-1.5 text-[12.5px] leading-[1.55]">
              The cover image the publisher shipped with this episode, captured at import. Kept
              as-is and never overwritten by artwork generation, so you always have the original to
              fall back on.
            </p>
          </div>
          <div className="border-border/60 mt-auto flex flex-wrap items-center gap-4 border-t pt-4">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-muted text-[12px] font-semibold hover:underline"
              download
            >
              Download original
            </a>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-muted-2 text-[12px] hover:underline"
            >
              View full-size ↗
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function AiVariantsSection({
  transcriptTooShort,
  anyAiUrl,
  hasPublisherArt,
  heroImageUrl,
  squareCoverUrl,
  verticalCoverUrl,
  concept,
}: {
  transcriptTooShort: boolean;
  anyAiUrl: boolean;
  hasPublisherArt: boolean;
  heroImageUrl: string | null;
  squareCoverUrl: string | null;
  verticalCoverUrl: string | null;
  concept: Concept | null;
}) {
  // When there's no publisher art AND the transcript is too short, the
  // top-level "Not ready" card is enough — don't render an empty AI
  // section next to it.
  if (transcriptTooShort && !hasPublisherArt) return null;

  return (
    <section aria-labelledby="ai-variants-heading">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 id="ai-variants-heading" className="font-display text-ink text-[15px] font-semibold">
          AI variants
        </h3>
        {concept?.subject && (
          <p className="text-muted-2 line-clamp-1 text-[12px]" title={conceptTooltip(concept)}>
            {concept.subject}
          </p>
        )}
      </div>

      {transcriptTooShort ? (
        <EmptyCard
          title="Not ready for AI variants"
          body="The transcript is too short for the model to derive a visual concept. Try again after transcription completes."
        />
      ) : anyAiUrl ? (
        <>
          <div className="border-border bg-surface rounded-2xl border p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
              <ArtworkFrame label="16:9 hero" url={heroImageUrl} aspect="aspect-[16/9]" />
              <ArtworkFrame label="1:1 square" url={squareCoverUrl} aspect="aspect-square" />
              <ArtworkFrame label="9:16 vertical" url={verticalCoverUrl} aspect="aspect-[9/16]" />
            </div>
          </div>
          {concept && <ConceptDetails concept={concept} />}
        </>
      ) : (
        <EmptyCard
          title="No AI variants yet"
          body={
            <>
              Click <strong className="text-ink font-semibold">Generate artwork</strong> to render
              16:9, 1:1, and 9:16 variants from the transcript. Takes about 30 seconds.
            </>
          }
        />
      )}
    </section>
  );
}

// ---- Bits ---------------------------------------------------------------

function ArtworkFrame({
  label,
  url,
  aspect,
}: {
  label: string;
  url: string | null;
  aspect: string;
}) {
  return (
    <div>
      <div className={`bg-surface-3 relative ${aspect} w-full overflow-hidden rounded-lg`}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={label} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="text-muted-2 flex h-full w-full items-center justify-center text-[11.5px]">
            Not generated
          </div>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-muted-2 text-[11.5px]">{label}</span>
        {url && (
          <a
            className="text-muted text-[11.5px] font-semibold hover:underline"
            href={url}
            target="_blank"
            rel="noreferrer"
            download
          >
            Download
          </a>
        )}
      </div>
    </div>
  );
}

function EmptyCard({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="border-border bg-surface rounded-2xl border p-8 text-center">
      <div className="font-display text-ink text-[15px] font-semibold">{title}</div>
      <p className="text-muted-2 mx-auto mt-1.5 max-w-md text-[13px] leading-[1.6]">{body}</p>
    </div>
  );
}

function ConceptDetails({ concept }: { concept: Concept }) {
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

function conceptTooltip(concept: Concept): string {
  const parts: string[] = [];
  if (concept.mood) parts.push(`Mood: ${concept.mood}`);
  if (concept.palette) parts.push(`Palette: ${concept.palette}`);
  if (concept.style) parts.push(`Style: ${concept.style}`);
  if (concept.textOverlay) parts.push(`Text: ${concept.textOverlay}`);
  return parts.join(" · ");
}
