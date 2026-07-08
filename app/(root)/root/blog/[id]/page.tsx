import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSystemAdminContext } from "@/server/auth/system";
import { getBlogPostByIdForAdmin } from "@/server/db/system/blog";
import { BlogPostForm } from "@/components/root/blog-post-form";

export const dynamic = "force-dynamic";

const ERROR_COPY: Record<string, string> = {
  invalid: "Invalid input — check the form fields.",
  not_found: "That post no longer exists.",
  forbidden: "This action requires ROOT or OPERATOR.",
  unknown: "Something went wrong. Check the server logs.",
};

export default async function EditBlogPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireSystemAdminContext();
  const canWrite = ctx.admin.role === "ROOT" || ctx.admin.role === "OPERATOR";

  const post = await getBlogPostByIdForAdmin(ctx, id);
  if (!post) notFound();

  const errorMessage = sp.error
    ? sp.detail
      ? `${ERROR_COPY[sp.error] ?? ERROR_COPY.unknown} — ${sp.detail}`
      : (ERROR_COPY[sp.error] ?? ERROR_COPY.unknown)
    : undefined;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <Link href="/root/blog" className="text-[12px] text-zinc-500 hover:text-zinc-300">
            ← Back to blog
          </Link>
          <h1 className="font-display mt-1 text-2xl font-semibold tracking-tight text-white">
            {post.title}
          </h1>
          <div className="font-mono text-[11px] text-zinc-500">
            /{post.slug} · updated {post.updatedAt.toISOString().slice(0, 16).replace("T", " ")}
            {post.updatedBy ? ` by ${post.updatedBy.name ?? post.updatedBy.email}` : ""}
          </div>
        </div>
      </div>

      {sp.ok ? (
        <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-100">
          Saved.
        </div>
      ) : null}

      <BlogPostForm post={post} canWrite={canWrite} errorDetail={errorMessage} />
    </div>
  );
}
