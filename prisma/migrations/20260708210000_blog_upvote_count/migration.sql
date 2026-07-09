-- Add `BlogPost.upvoteCount` — best-effort anonymous upvote counter.
-- Incremented by POST /api/blog/[slug]/upvote and decremented by DELETE on
-- the same route (with a > 0 guard so the counter can't go negative under
-- a rogue DELETE loop). No index: reads happen off the row hot-path
-- (fetched by slug or id) and we don't sort/filter by count.

ALTER TABLE "BlogPost" ADD COLUMN "upvoteCount" INTEGER NOT NULL DEFAULT 0;
