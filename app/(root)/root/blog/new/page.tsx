import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSystemAdminContext } from "@/server/auth/system";
import { BlogPostForm } from "@/components/root/blog-post-form";

export const dynamic = "force-dynamic";

export default async function NewBlogPostPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireSystemAdminContext();
  const canWrite = ctx.admin.role === "ROOT" || ctx.admin.role === "OPERATOR";

  // Not strictly needed — the form disables inputs — but sending a lower-role
  // admin here at all is a UX bug, so 404 the surface to match.
  if (!canWrite) notFound();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <Link href="/root/blog" className="text-[12px] text-zinc-500 hover:text-zinc-300">
            ← Back to blog
          </Link>
          <h1 className="font-display mt-1 text-2xl font-semibold tracking-tight text-white">
            New blog post
          </h1>
        </div>
      </div>

      <BlogPostForm post={null} canWrite={canWrite} errorDetail={sp.detail} />
    </div>
  );
}
