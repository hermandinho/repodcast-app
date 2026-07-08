import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { LandingFooter } from "@/components/landing/footer";
import { LandingNav } from "@/components/landing/nav";
import { listPublicBlogPosts } from "@/server/db/blog-public";

/**
 * `/blog` — public marketing index. Deliberately server-rendered off Prisma
 * (no client fetch) so the crawler sees fully-rendered content on first
 * paint. Post cards use plain `<a>` (via `next/link`) so social-share
 * scrapers get real HTML.
 *
 * The list is bounded to 50 for now; when the archive grows past that we
 * add pagination via `?page=` — until then, one page keeps the crawler
 * happy and the LCP low.
 */
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Blog — Repodcast",
  description:
    "Notes on voice-true content generation, podcast agency workflows, and everything we learn shipping Repodcast.",
  alternates: {
    canonical: "/blog",
    types: {
      "application/rss+xml": "/blog/rss.xml",
    },
  },
  openGraph: {
    type: "website",
    title: "Repodcast blog",
    description:
      "Notes on voice-true content generation, podcast agency workflows, and everything we learn shipping Repodcast.",
    url: "/blog",
  },
  twitter: {
    card: "summary_large_image",
    title: "Repodcast blog",
    description:
      "Notes on voice-true content generation, podcast agency workflows, and everything we learn shipping Repodcast.",
  },
};

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export default async function PublicBlogIndex() {
  const [{ userId }, posts] = await Promise.all([auth(), listPublicBlogPosts({ take: 50 })]);
  const isSignedIn = !!userId;

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
            Notes from the workshop.
          </h1>
          <p className="mt-4 max-w-[640px] text-[15px] leading-relaxed text-[#4A5878]">
            How we think about voice-true content generation, what podcast agencies actually need
            from a tool like this, and everything we learn shipping Repodcast.
          </p>
        </div>
      </section>

      <section className="mx-auto px-7 py-16" style={{ maxWidth: 1080 }}>
        {posts.length === 0 ? (
          <div className="rounded-2xl border border-[#ECEEF3] bg-[#FBFCFE] p-12 text-center">
            <p className="text-[15px] text-[#4A5878]">
              Nothing published yet. First post is on the way.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>
        )}
      </section>

      <LandingFooter />
    </div>
  );
}

function PostCard({ post }: { post: Awaited<ReturnType<typeof listPublicBlogPosts>>[number] }) {
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
          <div className="mt-4 flex items-center gap-3 text-[12px] text-[#6B7BA3]">
            <time dateTime={post.publishedAt.toISOString()}>
              {DATE_FMT.format(post.publishedAt)}
            </time>
            {post.readingMinutes ? <span>·</span> : null}
            {post.readingMinutes ? <span>{post.readingMinutes} min read</span> : null}
          </div>
        </div>
      </Link>
    </article>
  );
}
