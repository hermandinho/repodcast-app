import Link from "next/link";
import { formatViewCount } from "@/lib/blog";
import { requireSystemAdminContext } from "@/server/auth/system";
import { listBlogPostsForAdmin, type BlogPostRow } from "@/server/db/system/blog";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<BlogPostRow["status"], string> = {
  DRAFT: "bg-zinc-800/60 text-zinc-300",
  SCHEDULED: "bg-indigo-900/40 text-indigo-200",
  PUBLISHED: "bg-emerald-900/40 text-emerald-200",
  ARCHIVED: "bg-zinc-900/60 text-zinc-500 line-through",
};

const STATUS_FILTERS = ["", "DRAFT", "SCHEDULED", "PUBLISHED", "ARCHIVED"] as const;

const ERROR_COPY: Record<string, string> = {
  invalid: "Invalid input — check the form fields.",
  forbidden: "This action requires ROOT or OPERATOR.",
  not_found: "That post no longer exists.",
  unknown: "Something went wrong. Check the server logs.",
};

export default async function RootBlogPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await requireSystemAdminContext();

  const canWrite = ctx.admin.role === "ROOT" || ctx.admin.role === "OPERATOR";
  const statusFilter = coerceStatus(sp.status);
  const rows = await listBlogPostsForAdmin(ctx, {
    status: statusFilter ?? undefined,
    search: sp.q,
    take: 100,
  });

  const counts = {
    all: rows.length,
    draft: rows.filter((r) => r.status === "DRAFT").length,
    scheduled: rows.filter((r) => r.status === "SCHEDULED").length,
    published: rows.filter((r) => r.status === "PUBLISHED").length,
    archived: rows.filter((r) => r.status === "ARCHIVED").length,
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white">Blog</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Public marketing content served under <code className="text-zinc-300">/blog</code>.
            Every write lands a{" "}
            <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[11px] text-zinc-300">
              SystemAuditLog
            </code>{" "}
            row. Writes require the{" "}
            <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[11px] text-zinc-300">
              ROOT
            </code>{" "}
            or{" "}
            <code className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[11px] text-zinc-300">
              OPERATOR
            </code>{" "}
            role.
          </p>
        </div>
        {canWrite ? (
          <Link
            href="/root/blog/new"
            className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-100 hover:bg-red-500/20"
          >
            New post
          </Link>
        ) : null}
      </header>

      {sp.error ? (
        <div className="rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-100">
          {ERROR_COPY[sp.error] ?? ERROR_COPY.unknown}
        </div>
      ) : null}
      {sp.ok ? (
        <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-100">
          {sp.ok === "deleted" ? "Post deleted." : "Saved."}
        </div>
      ) : null}

      <form
        method="get"
        className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3"
      >
        <div className="flex gap-1">
          {STATUS_FILTERS.map((s) => {
            const active = (statusFilter ?? "") === s;
            const label = s === "" ? "All" : s.charAt(0) + s.slice(1).toLowerCase();
            return (
              <button
                key={s || "all"}
                type="submit"
                name="status"
                value={s}
                className={[
                  "rounded-md border px-3 py-1.5 text-[12.5px] font-medium",
                  active
                    ? "border-red-500/60 bg-red-500/10 text-red-100"
                    : "border-zinc-700 text-zinc-300 hover:bg-zinc-800",
                ].join(" ")}
              >
                {label}
              </button>
            );
          })}
        </div>
        <input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search title or slug…"
          className="ml-auto w-56 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
        />
        <button
          type="submit"
          className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
        >
          Search
        </button>
      </form>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatChip label="Total" value={counts.all} />
        <StatChip label="Draft" value={counts.draft} />
        <StatChip label="Scheduled" value={counts.scheduled} />
        <StatChip label="Published" value={counts.published} />
        <StatChip label="Archived" value={counts.archived} />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/40 p-8 text-center text-sm text-zinc-500">
          No posts match. {canWrite ? "Start one with “New post”." : null}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] tracking-wider text-zinc-500 uppercase">
              <tr className="border-b border-zinc-800">
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Author</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Views</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Public URL</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-zinc-800 last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/root/blog/${row.id}`}
                      className="flex flex-col text-zinc-100 hover:text-white"
                    >
                      <span className="font-medium">{row.title}</span>
                      <span className="font-mono text-[11px] text-zinc-500">/{row.slug}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-2 py-0.5 font-mono text-[10.5px] tracking-wider uppercase ${STATUS_STYLES[row.status]}`}
                    >
                      {row.status.toLowerCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[12.5px] text-zinc-400">
                    {row.author?.name ?? row.author?.email ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-[12.5px] text-zinc-400">{row.category ?? "—"}</td>
                  <td
                    className="px-4 py-3 text-right font-mono text-[12.5px] text-zinc-300 tabular-nums"
                    title={`${row.viewCount.toLocaleString()} views`}
                  >
                    {formatViewCount(row.viewCount)}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-zinc-500">
                    {row.updatedAt.toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="px-4 py-3 text-[12.5px]">
                    {row.status === "PUBLISHED" || row.status === "SCHEDULED" ? (
                      <Link
                        href={`/blog/${row.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-zinc-300 hover:text-white hover:underline"
                      >
                        /blog/{row.slug} ↗
                      </Link>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
      <div className="font-mono text-[10.5px] tracking-wider text-zinc-500 uppercase">{label}</div>
      <div className="font-display mt-1 text-xl font-semibold text-white tabular-nums">{value}</div>
    </div>
  );
}

function coerceStatus(v: string | undefined): BlogPostRow["status"] | null {
  if (v === "DRAFT" || v === "SCHEDULED" || v === "PUBLISHED" || v === "ARCHIVED") return v;
  return null;
}
