import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { formatViewCount } from "@/lib/blog";
import { getBlogIndexOgImageUrl } from "@/lib/blog-index-og";
import { listPublicBlogPosts, type PublicBlogListItem } from "@/server/db/blog-public";

/**
 * `/blog` — public marketing index. Deliberately server-rendered off Prisma
 * (no client fetch) so the crawler sees fully-rendered content on first
 * paint. Post cards use plain `<a>` (via `next/link`) so social-share
 * scrapers get real HTML.
 *
 * Structure:
 *   1. Hero (H1 + subtitle + category chips)
 *   2. Featured post — the newest live post, rendered full-width. Skipped
 *      when a category filter is active (a chip drill-down shows the raw
 *      grid; a "featured" card on top would be visual noise there).
 *   3. Grid of the remaining posts.
 *
 * The list is bounded to 50; pagination lands the day we cross that. Until
 * then, one page keeps the crawler happy and the LCP low.
 */
export const revalidate = 300;

/**
 * Category chips surfaced on the hero. Case-insensitive match against the
 * `BlogPost.category` column (see `listPublicBlogPosts`), so operators can
 * author with any casing. Keep this list short — chips are for the biggest
 * pillars, not a full tag index. Free-form authoring stays available on the
 * admin form; unchipped categories still filter via `?category=X`.
 */
const CATEGORY_CHIPS = ["Voice", "Workflow", "Agency", "Buyer guide"] as const;

const META_TITLE = "Repodcast Blog — Voice, repurposing & growth for podcast agencies";
const META_DESCRIPTION =
  "Practical guides on podcast repurposing, voice matching, show notes, and scaling a podcast agency — from the team building Repodcast.";
const META_KEYWORDS = [
  "podcast agency blog",
  "podcast repurposing",
  "podcast content marketing",
  "podcast agency growth",
];

export async function generateMetadata(): Promise<Metadata> {
  const ogImage = await getBlogIndexOgImageUrl();
  return {
    title: META_TITLE,
    description: META_DESCRIPTION,
    keywords: META_KEYWORDS,
    alternates: {
      canonical: "/blog",
      types: {
        "application/rss+xml": "/blog/rss.xml",
      },
    },
    // Explicitly index — the coming-soon page opts out separately, so being
    // clear here documents the intent for anyone auditing crawl posture.
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      title: META_TITLE,
      description: META_DESCRIPTION,
      url: "/blog",
      siteName: "Repodcast",
      images: ogImage ? [{ url: ogImage }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: META_TITLE,
      description: META_DESCRIPTION,
      images: ogImage ? [ogImage] : undefined,
    },
  };
}

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export default async function PublicBlogIndex({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const [{ userId }, sp] = await Promise.all([auth(), searchParams]);
  const activeCategory = normaliseCategoryParam(sp.category);
  const posts = await listPublicBlogPosts({
    take: 50,
    category: activeCategory ?? undefined,
  });
  const isSignedIn = !!userId;

  // Featured hero: newest post, only on the unfiltered index. On a filtered
  // view we render the plain grid — pulling one card out for "featured" on
  // a drill-down looks weird when the second card is right below it.
  const showFeatured = !activeCategory && posts.length > 1;
  const featured = showFeatured ? posts[0] : null;
  const grid = showFeatured ? posts.slice(1) : posts;

  return (
    <div className="w-full overflow-x-hidden bg-white">
      <LandingNav isSignedIn={isSignedIn} />

      <section
        className="relative overflow-hidden"
        style={{
          background: "linear-gradient(180deg,#fff 0%,#FBFCFE 100%)",
          borderBottom: "1px solid #ECEEF3",
        }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(#1A2A4A 0.8px, transparent 0.8px)",
            backgroundSize: "24px 24px",
            opacity: 0.035,
          }}
        />
        <div
          className="relative mx-auto px-7"
          style={{ maxWidth: 1080, paddingTop: 92, paddingBottom: 48 }}
        >
          <p
            className="m-0 text-[11px] font-medium uppercase"
            style={{
              fontFamily: "var(--font-mono)",
              color: "#6B7BA3",
              letterSpacing: "0.1em",
            }}
          >
            Blog
          </p>
          <h1
            className="mt-3 text-[44px] font-bold tracking-tight text-[#0A1633] md:text-[52px]"
            style={{ fontFamily: "var(--font-display)", lineHeight: 1.05 }}
          >
            Field notes for podcast agencies
          </h1>
          <p className="mt-4 max-w-[640px] text-[15px] leading-relaxed text-[#4A5878]">
            Practical writing on voice, repurposing, and running a podcast agency that scales — from
            the team building Repodcast.
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-2">
            <CategoryChip label="All" href="/blog" active={activeCategory === null} />
            {CATEGORY_CHIPS.map((chip) => (
              <CategoryChip
                key={chip}
                label={chip}
                href={`/blog?category=${encodeURIComponent(chip)}`}
                active={activeCategory?.toLowerCase() === chip.toLowerCase()}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto px-7 py-16" style={{ maxWidth: 1080 }}>
        {posts.length === 0 ? (
          <EmptyState hasFilter={activeCategory !== null} />
        ) : (
          <>
            {featured ? <FeaturedCard post={featured} /> : null}
            {grid.length > 0 ? (
              <div
                className={[
                  "grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3",
                  featured ? "mt-12" : "",
                ].join(" ")}
              >
                {grid.map((post) => (
                  <PostCard key={post.slug} post={post} />
                ))}
              </div>
            ) : null}
          </>
        )}
      </section>

      <LandingFooter />
    </div>
  );
}

/**
 * Normalise `?category=` into either a non-empty string or `null`. Trims
 * whitespace and rejects the string "all" (which the "All" chip emits as an
 * empty href, but a hand-typed URL might carry).
 */
function normaliseCategoryParam(raw: string | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "all") return null;
  return trimmed;
}

function CategoryChip({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={[
        "rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors",
        active
          ? "border-[#3A5BA0] bg-[#3A5BA0] text-white"
          : "border-[#DDE2EE] bg-white text-[#3A5BA0] hover:border-[#3A5BA0]",
      ].join(" ")}
      style={{ fontFamily: "var(--font-mono)" }}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </Link>
  );
}

function FeaturedCard({ post }: { post: PublicBlogListItem }) {
  return (
    <article className="group overflow-hidden rounded-3xl border border-[#ECEEF3] bg-white transition-shadow hover:shadow-lg">
      <Link href={`/blog/${post.slug}`} className="grid grid-cols-1 md:grid-cols-2">
        {post.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.coverImageUrl}
            alt=""
            className="h-full max-h-[380px] w-full object-cover md:max-h-none"
          />
        ) : (
          <div
            className="min-h-[240px] w-full md:min-h-0"
            style={{
              background: "linear-gradient(135deg,#1A2A4A 0%,#3A5BA0 60%,#5C7CC0 100%)",
            }}
          />
        )}
        <div className="flex flex-col justify-center gap-4 p-8 md:p-10">
          <div className="flex items-center gap-2">
            <span
              className="rounded-full bg-[#F3EDFA] px-2.5 py-1 text-[11px] font-semibold tracking-wider text-[#6B4EAF] uppercase"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Featured
            </span>
            {post.category ? (
              <span
                className="rounded-full bg-[#EDF1FA] px-2.5 py-1 text-[11px] font-semibold tracking-wider text-[#3A5BA0] uppercase"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {post.category}
              </span>
            ) : null}
          </div>
          <h2
            className="text-[28px] leading-tight font-bold tracking-tight text-[#0A1633] group-hover:text-[#3A5BA0] md:text-[32px]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {post.title}
          </h2>
          <p className="text-[15px] leading-relaxed text-[#4A5878]">{post.excerpt}</p>
          <div className="flex flex-wrap items-center gap-3 text-[12.5px] text-[#6B7BA3]">
            {post.author?.name ? <span>By {post.author.name}</span> : null}
            {post.author?.name ? <span>·</span> : null}
            <time dateTime={post.publishedAt.toISOString()}>
              {DATE_FMT.format(post.publishedAt)}
            </time>
            {post.readingMinutes ? <span>·</span> : null}
            {post.readingMinutes ? <span>{post.readingMinutes} min read</span> : null}
            <span>·</span>
            <span aria-label={`${post.viewCount} views`}>
              {formatViewCount(post.viewCount)} views
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

function PostCard({ post }: { post: PublicBlogListItem }) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-[#ECEEF3] bg-white transition-shadow hover:shadow-md">
      <Link href={`/blog/${post.slug}`} className="flex flex-col">
        {post.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.coverImageUrl}
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
        <div className="flex flex-1 flex-col p-6">
          {post.category ? (
            <span
              className="mb-2 self-start rounded-full bg-[#EDF1FA] px-2.5 py-1 text-[11px] font-semibold tracking-wider text-[#3A5BA0] uppercase"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {post.category}
            </span>
          ) : null}
          <h2
            className="text-[19px] leading-snug font-bold tracking-tight text-[#0A1633] group-hover:text-[#3A5BA0]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {post.title}
          </h2>
          <p className="mt-2 line-clamp-3 flex-1 text-[14px] leading-relaxed text-[#4A5878]">
            {post.excerpt}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-[12px] text-[#6B7BA3]">
            <time dateTime={post.publishedAt.toISOString()}>
              {DATE_FMT.format(post.publishedAt)}
            </time>
            {post.readingMinutes ? <span>·</span> : null}
            {post.readingMinutes ? <span>{post.readingMinutes} min read</span> : null}
            <span>·</span>
            <span aria-label={`${post.viewCount} views`}>
              {formatViewCount(post.viewCount)} views
            </span>
          </div>
        </div>
      </Link>
    </article>
  );
}

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  if (hasFilter) {
    return (
      <div className="rounded-2xl border border-[#ECEEF3] bg-[#FBFCFE] p-12 text-center">
        <p className="text-[15px] text-[#4A5878]">
          Nothing under that category yet.{" "}
          <Link href="/blog" className="font-medium text-[#3A5BA0] hover:underline">
            See every post →
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-[#ECEEF3] bg-[#FBFCFE] p-12 text-center">
      <p className="text-[15px] text-[#4A5878]">
        First posts are on the way. In the meantime,{" "}
        <Link href="/#voice" className="font-medium text-[#3A5BA0] hover:underline">
          see how the voice engine works →
        </Link>
      </p>
    </div>
  );
}
