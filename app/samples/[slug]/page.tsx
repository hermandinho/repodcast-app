import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { SampleDeliveryPage } from "@/components/samples/sample-delivery-page";
import { listSampleSlugs, resolveSample } from "@/lib/samples/registry";

/**
 * Public "sample delivery" surface.
 *
 * Statically pre-rendered at build time via `generateStaticParams` +
 * `dynamic = "force-static"`. Curated slugs live in
 * `lib/samples/registry.ts`; the page is intentionally kept off the
 * dashboard chrome (no auth, no `resolveTenantContext`) — cold traffic
 * arrives here without a session and must never be redirected to sign
 * in.
 *
 * A missing slug returns 404 instead of falling back to a default —
 * unknown slugs are almost always typos or removed pages, and silently
 * redirecting would break SEO signals for the good slugs.
 */

export const dynamic = "force-static";
export const revalidate = false;

export async function generateStaticParams() {
  return listSampleSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const sample = resolveSample(slug);
  if (!sample) {
    return { title: "Sample not found — Repodcast" };
  }
  const title = `${sample.episodeTitle} — sample launch kit · Repodcast`;
  const description = `See one full launch kit from a single 52-minute episode of ${sample.show.name}: seven platform posts, vertical clips, hero artwork, and audiograms — all in the host's voice.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function SamplePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sample = resolveSample(slug);
  if (!sample) notFound();

  return (
    <div className="w-full overflow-x-hidden bg-white">
      <LandingNav isSignedIn={false} />
      <SampleDeliveryPage sample={sample} />
      <LandingFooter />
    </div>
  );
}
