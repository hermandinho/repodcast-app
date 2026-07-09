import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { BlogViewBeacon } from "@/components/blog/view-beacon";
import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { getPublicBlogPostBySlug, listRelatedPublicPosts } from "@/server/db/blog-public";
import { formatViewCount, publicBlogUrl, renderMarkdown } from "@/lib/blog";

/**
 * `/blog/[slug]` — public post page.
 *
 * SEO wiring:
 *   - `generateMetadata` emits OG + Twitter + canonical + optional noindex.
 *   - JSON-LD `Article` schema in a `<script>` tag; overridable per-post via
 *     `structuredDataJson`.
 *   - Static params are pre-generated at build time from every currently
 *     PUBLISHED / SCHEDULED-past-date post. New posts land on the next
 *     revalidation (300s) or on a manual `revalidatePath` from the admin.
 */

export const revalidate = 300;

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

type RouteParams = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublicBlogPostBySlug(slug);
  if (!post) return {};

  const title = post.metaTitle ?? `${post.title} — Repodcast`;
  const description = post.metaDescription ?? post.excerpt;
  const canonical = post.canonicalUrl ?? `/blog/${post.slug}`;
  const ogImage = post.coverImageUrl ?? undefined;

  return {
    title,
    description,
    keywords: post.keywords.length > 0 ? post.keywords : undefined,
    alternates: {
      canonical,
    },
    robots: post.noindex ? { index: false, follow: true } : { index: true, follow: true },
    openGraph: {
      type: "article",
      title,
      description,
      url: `/blog/${post.slug}`,
      siteName: "Repodcast",
      publishedTime: post.publishedAt.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      authors: post.author?.name ? [post.author.name] : undefined,
      images: ogImage ? [{ url: ogImage }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

export default async function PublicBlogPostPage({ params }: { params: Promise<RouteParams> }) {
  const { slug } = await params;
  const [{ userId }, post] = await Promise.all([auth(), getPublicBlogPostBySlug(slug)]);
  if (!post) notFound();

  const isSignedIn = !!userId;
  const bodyHtml = renderMarkdown(post.bodyMarkdown);
  const related = await listRelatedPublicPosts({
    currentSlug: post.slug,
    tags: post.tags,
    take: 3,
  });

  const structuredData = post.structuredDataJson ?? buildArticleSchema(post);

  return (
    <div className="w-full overflow-x-hidden bg-white">
      <LandingNav isSignedIn={isSignedIn} />

      <article className="mx-auto px-7 pt-16 pb-8" style={{ maxWidth: 760 }}>
        <div className="mb-4 flex items-center gap-2 text-[12px] text-[#6B7BA3]">
          <Link href="/blog" className="hover:text-[#3A5BA0]">
            Blog
          </Link>
          {post.category ? (
            <>
              <span>›</span>
              <Link
                href={`/blog?category=${encodeURIComponent(post.category)}`}
                className="hover:text-[#3A5BA0]"
              >
                {post.category}
              </Link>
            </>
          ) : null}
        </div>

        <h1
          className="text-[38px] leading-[1.1] font-bold tracking-tight text-[#0A1633] md:text-[46px]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {post.title}
        </h1>

        <div className="mt-5 flex flex-wrap items-center gap-3 text-[13px] text-[#4A5878]">
          {post.author?.name ? <span>By {post.author.name}</span> : null}
          {post.author?.name ? <span>·</span> : null}
          <time dateTime={post.publishedAt.toISOString()}>{DATE_FMT.format(post.publishedAt)}</time>
          {post.readingMinutes ? <span>·</span> : null}
          {post.readingMinutes ? <span>{post.readingMinutes} min read</span> : null}
          <span>·</span>
          <span aria-label={`${post.viewCount} views`}>
            {formatViewCount(post.viewCount)} views
          </span>
        </div>

        {post.coverImageUrl ? (
          <div className="mt-8 overflow-hidden rounded-2xl border border-[#ECEEF3]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={post.coverImageUrl} alt="" className="aspect-[16/9] w-full object-cover" />
          </div>
        ) : null}

        <div
          className="blog-body mt-10 text-[16.5px] leading-[1.75] text-[#1A2A4A]"
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />

        {post.tags.length > 0 ? (
          <div className="mt-10 flex flex-wrap items-center gap-2 border-t border-[#ECEEF3] pt-6">
            <span
              className="text-[11px] font-semibold tracking-wider text-[#6B7BA3] uppercase"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Tags
            </span>
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-[#F3F6FD] px-3 py-1 text-[12px] font-medium text-[#3A5BA0]"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </article>

      {related.length > 0 ? (
        <section
          className="mx-auto px-7 pb-24"
          style={{ maxWidth: 1080 }}
          aria-label="Related posts"
        >
          <div className="border-t border-[#ECEEF3] pt-12">
            <h2
              className="text-[22px] font-bold tracking-tight text-[#0A1633]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Related reading
            </h2>
            <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  href={`/blog/${r.slug}`}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-[#ECEEF3] bg-white transition-shadow hover:shadow-md"
                >
                  {r.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.coverImageUrl}
                      alt=""
                      className="aspect-[16/9] w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div
                      className="aspect-[16/9] w-full"
                      style={{
                        background: "linear-gradient(135deg,#1A2A4A 0%,#3A5BA0 60%,#5C7CC0 100%)",
                      }}
                    />
                  )}
                  <div className="flex flex-col p-5">
                    <h3
                      className="text-[16px] leading-snug font-bold tracking-tight text-[#0A1633] group-hover:text-[#3A5BA0]"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      {r.title}
                    </h3>
                    <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-[#4A5878]">
                      {r.excerpt}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <LandingFooter />

      <BlogViewBeacon slug={post.slug} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
    </div>
  );
}

/**
 * Default JSON-LD schema. If the row carries a `structuredDataJson` override
 * we use that instead so authors can layer in `FAQPage` / `HowTo` /
 * fine-grained authorship.
 */
function buildArticleSchema(post: Awaited<ReturnType<typeof getPublicBlogPostBySlug>>): unknown {
  if (!post) return null;
  const url = publicBlogUrl(post.slug);
  const image = post.coverImageUrl ?? undefined;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.metaDescription ?? post.excerpt,
    datePublished: post.publishedAt.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
    url,
    ...(image ? { image: [image] } : {}),
    ...(post.author?.name
      ? {
          author: {
            "@type": "Person",
            name: post.author.name,
          },
        }
      : {}),
    publisher: {
      "@type": "Organization",
      name: "Repodcast",
    },
    ...(post.keywords.length > 0 ? { keywords: post.keywords.join(", ") } : {}),
  };
}
