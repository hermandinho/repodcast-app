import { Card } from "@/components/ui/card";

/**
 * Q1 feature #4 — inline preview strip of the three artwork variants.
 * Rendered on the episode page just above the outputs grid. When no
 * artwork exists, the strip stays hidden; the "Artwork" button in the
 * header is the CTA that gets things rolling.
 *
 * Pure JSX (no client directives, no state) — safe to import into
 * client trees. The images are <img> tags on public R2 URLs; we deliberately
 * bypass next/image because the R2 base URL is agency-controlled and
 * shifting the Vercel Image Optimization allowlist for every deploy is
 * more churn than the marginal LCP win is worth here.
 */

export type ArtworkStripProps = {
  heroImageUrl: string | null;
  squareCoverUrl: string | null;
  verticalCoverUrl: string | null;
  concept: {
    subject?: string;
    mood?: string;
    palette?: string;
    textOverlay?: string;
    style?: string;
  } | null;
};

export function ArtworkStrip(props: ArtworkStripProps) {
  const { heroImageUrl, squareCoverUrl, verticalCoverUrl, concept } = props;
  const anyUrl = heroImageUrl || squareCoverUrl || verticalCoverUrl;
  if (!anyUrl) return null;

  return (
    <Card className="mb-[22px] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-ink text-[14px] font-semibold">Hero artwork</h2>
        {concept?.subject && (
          <p className="text-muted-2 line-clamp-1 text-[12px]" title={conceptTooltip(concept)}>
            {concept.subject}
          </p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[2fr_1fr_1fr]">
        <ArtworkFrame label="16:9 hero" url={heroImageUrl} aspect="aspect-[16/9]" />
        <ArtworkFrame label="1:1 square" url={squareCoverUrl} aspect="aspect-square" />
        <ArtworkFrame label="9:16 vertical" url={verticalCoverUrl} aspect="aspect-[9/16]" />
      </div>
    </Card>
  );
}

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
          // eslint-disable-next-line @next/next/no-img-element -- see file header
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

function conceptTooltip(concept: NonNullable<ArtworkStripProps["concept"]>): string {
  const parts: string[] = [];
  if (concept.mood) parts.push(`Mood: ${concept.mood}`);
  if (concept.palette) parts.push(`Palette: ${concept.palette}`);
  if (concept.style) parts.push(`Style: ${concept.style}`);
  if (concept.textOverlay) parts.push(`Text: ${concept.textOverlay}`);
  return parts.join(" · ");
}
