-- Add `BlogPost.viewCount` — best-effort public page-view counter incremented
-- via `POST /api/blog/[slug]/view` on client beacon requests. Not indexed:
-- reads happen on the row hot path (already fetched by slug or id) and we
-- don't sort/filter by count. If we ever add a "trending" surface, add an
-- index at that point.

ALTER TABLE "BlogPost" ADD COLUMN "viewCount" INTEGER NOT NULL DEFAULT 0;
