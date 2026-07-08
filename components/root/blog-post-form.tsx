import type { BlogPostRow } from "@/server/db/system/blog";
import { publicBlogUrl } from "@/lib/blog";
import { deleteBlogPostAction, upsertBlogPostAction } from "@/app/(root)/root/blog/actions";
import { BlogSlugTitleFields } from "@/components/root/blog-slug-title-fields";
import { BlogImageField } from "@/components/root/blog-image-field";
import { BlogBodyEditor } from "@/components/root/blog-body-editor";

/**
 * Big form covering every field on `BlogPost`. Deliberately a plain server-
 * component form: server actions handle the round trip, no client JS needed
 * for the basic authoring flow. The "Preview" surface is a separate route so
 * we don't have to reach for `use client` on this file.
 *
 * The right rail renders the SEO preview live from the form's saved values —
 * to preview unsaved edits, save as DRAFT first and re-render.
 */
export function BlogPostForm({
  post,
  canWrite,
  errorDetail,
}: {
  /** null when creating a new post. */
  post: BlogPostRow | null;
  canWrite: boolean;
  errorDetail?: string;
}) {
  const isEdit = !!post;
  const status = post?.status ?? "DRAFT";
  const publishedAtInput = post?.publishedAt ? post.publishedAt.toISOString().slice(0, 16) : "";

  const metaTitle = post?.metaTitle ?? post?.title ?? "Title of the post";
  const metaDescription = post?.metaDescription ?? post?.excerpt ?? "";
  const previewUrl = post ? publicBlogUrl(post.slug) : "https://repodcastapp.com/blog/…";

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <form action={upsertBlogPostAction} className="flex flex-col gap-6">
        {post ? <input type="hidden" name="id" value={post.id} /> : null}

        {errorDetail ? (
          <div className="rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-100">
            {errorDetail}
          </div>
        ) : null}

        <Section title="Content">
          <BlogSlugTitleFields
            initialTitle={post?.title ?? ""}
            initialSlug={post?.slug ?? ""}
            disabled={!canWrite}
          />

          <Field label="Excerpt" hint="Card summary + OG description fallback.">
            <textarea
              name="excerpt"
              required
              maxLength={320}
              rows={3}
              defaultValue={post?.excerpt ?? ""}
              className={inputCls}
              disabled={!canWrite}
            />
          </Field>

          <Field
            label="Body (Markdown)"
            hint="Safe subset: headings, links, images, lists, code blocks. Raw HTML is escaped."
          >
            <BlogBodyEditor
              name="bodyMarkdown"
              initialValue={post?.bodyMarkdown ?? ""}
              disabled={!canWrite}
            />
          </Field>

          <Field
            label="Cover image"
            hint="Also used as the social share card (Open Graph + Twitter). Upload to R2 or paste any absolute URL."
          >
            <BlogImageField
              name="coverImageUrl"
              initialValue={post?.coverImageUrl ?? ""}
              disabled={!canWrite}
            />
          </Field>
        </Section>

        <Section title="Editorial">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Category" hint="Free-form (e.g. engineering, voice, case-study).">
              <input
                name="category"
                maxLength={60}
                defaultValue={post?.category ?? ""}
                className={inputCls}
                disabled={!canWrite}
              />
            </Field>
            <Field label="Reading minutes (optional)" hint="Auto-computed if blank.">
              <input
                type="number"
                name="readingMinutes"
                min={1}
                max={120}
                defaultValue={post?.readingMinutes ?? ""}
                className={inputCls}
                disabled={!canWrite}
              />
            </Field>
          </div>
          <Field
            label="Tags"
            hint="Comma- or newline-separated. Used for related-posts + tag pages."
          >
            <textarea
              name="tags"
              rows={2}
              defaultValue={post?.tags.join(", ") ?? ""}
              className={inputCls}
              disabled={!canWrite}
            />
          </Field>
        </Section>

        <Section title="SEO">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Meta title" hint="Falls back to Title. ~60 chars.">
              <input
                name="metaTitle"
                maxLength={70}
                defaultValue={post?.metaTitle ?? ""}
                className={inputCls}
                disabled={!canWrite}
              />
            </Field>
            <Field label="Canonical URL" hint="Set when syndicated from/to another site.">
              <input
                type="url"
                name="canonicalUrl"
                maxLength={500}
                defaultValue={post?.canonicalUrl ?? ""}
                className={inputCls}
                disabled={!canWrite}
              />
            </Field>
          </div>
          <Field label="Meta description" hint="Falls back to Excerpt. ~160 chars.">
            <textarea
              name="metaDescription"
              rows={2}
              maxLength={200}
              defaultValue={post?.metaDescription ?? ""}
              className={inputCls}
              disabled={!canWrite}
            />
          </Field>
          <Field
            label="Keywords"
            hint="Comma- or newline-separated. Rendered as <meta name='keywords'>."
          >
            <textarea
              name="keywords"
              rows={2}
              defaultValue={post?.keywords.join(", ") ?? ""}
              className={inputCls}
              disabled={!canWrite}
            />
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-zinc-300">
            <input
              type="checkbox"
              name="noindex"
              defaultChecked={post?.noindex ?? false}
              disabled={!canWrite}
              className="h-4 w-4 rounded border-zinc-700 bg-zinc-950"
            />
            noindex — request search engines skip this post
          </label>
          <Field
            label="Structured data JSON (optional)"
            hint="Override the default Article schema. Emitted as-is inside <script type='application/ld+json'>."
          >
            <textarea
              name="structuredDataJson"
              rows={6}
              maxLength={20_000}
              defaultValue={
                post?.structuredDataJson ? JSON.stringify(post.structuredDataJson, null, 2) : ""
              }
              className={inputCls + " font-mono text-[12px]"}
              disabled={!canWrite}
            />
          </Field>
        </Section>

        <Section title="Lifecycle">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Status">
              <select name="status" defaultValue={status} className={inputCls} disabled={!canWrite}>
                <option value="DRAFT">Draft</option>
                <option value="SCHEDULED">Scheduled (future date)</option>
                <option value="PUBLISHED">Published</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </Field>
            <Field
              label="Publish date"
              hint="Required for Scheduled. Optional for Published (defaults to now)."
            >
              <input
                type="datetime-local"
                name="publishedAt"
                defaultValue={publishedAtInput}
                className={inputCls}
                disabled={!canWrite}
              />
            </Field>
          </div>
          <Field label="Audit note" hint="Recorded on the SystemAuditLog row.">
            <input
              name="note"
              maxLength={500}
              placeholder="e.g. Added launch case study"
              className={inputCls}
              disabled={!canWrite}
            />
          </Field>
        </Section>

        {canWrite ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="rounded-md border border-red-500/60 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-100 hover:bg-red-500/20"
            >
              {isEdit ? "Save changes" : "Create post"}
            </button>
            {isEdit && post ? (
              <a
                href={`/blog/${post.slug}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
              >
                View public page ↗
              </a>
            ) : null}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 p-4 text-[12.5px] text-zinc-500">
            Your role is read-only. Ask a ROOT or OPERATOR to edit.
          </div>
        )}
      </form>

      <aside className="flex flex-col gap-6">
        <SeoPreviewCard title={metaTitle} description={metaDescription} url={previewUrl} />
        <SocialPreviewCard
          title={metaTitle}
          description={metaDescription}
          imageUrl={post?.coverImageUrl ?? null}
        />

        {isEdit && post && canWrite ? (
          <form
            action={deleteBlogPostAction}
            className="flex flex-col gap-2 rounded-xl border border-red-900/60 bg-red-950/20 p-4"
          >
            <div className="font-mono text-[10.5px] tracking-wider text-red-200 uppercase">
              Danger zone
            </div>
            <p className="text-[12.5px] text-red-100/80">
              Hard-delete this post. The audit log keeps the before-image forever.
            </p>
            <input type="hidden" name="id" value={post.id} />
            <input type="hidden" name="slug" value={post.slug} />
            <input
              name="note"
              required
              minLength={3}
              placeholder="Reason (required)"
              className="rounded-md border border-red-900/60 bg-zinc-950 px-3 py-2 text-[12.5px] text-red-100 placeholder:text-red-300/50"
            />
            <button
              type="submit"
              className="self-start rounded-md border border-red-500/60 bg-red-500/20 px-3 py-2 text-[12.5px] font-medium text-red-100 hover:bg-red-500/30"
            >
              Delete post
            </button>
          </form>
        ) : null}
      </aside>
    </div>
  );
}

// ============================================================
// Preview cards
// ============================================================

function SeoPreviewCard({
  title,
  description,
  url,
}: {
  title: string;
  description: string;
  url: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="font-mono text-[10.5px] tracking-wider text-zinc-500 uppercase">
        Google preview
      </div>
      <div className="mt-3 rounded-md bg-white p-4 text-black">
        <div className="text-[12px] text-[#4d5156]">{url}</div>
        <div className="mt-1 truncate text-[17px] font-medium text-[#1a0dab]">{title}</div>
        <div className="mt-1 line-clamp-2 text-[13px] text-[#4d5156]">{description}</div>
      </div>
    </div>
  );
}

function SocialPreviewCard({
  title,
  description,
  imageUrl,
}: {
  title: string;
  description: string;
  imageUrl: string | null;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="font-mono text-[10.5px] tracking-wider text-zinc-500 uppercase">
        Social card
      </div>
      <div className="mt-3 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="aspect-[1.91/1] w-full object-cover" />
        ) : (
          <div className="flex aspect-[1.91/1] w-full items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900 text-[11px] text-zinc-500">
            no cover image
          </div>
        )}
        <div className="p-3">
          <div className="truncate text-[13px] font-medium text-white">{title}</div>
          <div className="mt-1 line-clamp-2 text-[12px] text-zinc-400">{description}</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Field helpers
// ============================================================

const inputCls =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 disabled:cursor-not-allowed disabled:opacity-60";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <h2 className="font-mono text-[10.5px] tracking-[0.18em] text-zinc-500 uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-zinc-200">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-zinc-500">{hint}</span> : null}
    </label>
  );
}
