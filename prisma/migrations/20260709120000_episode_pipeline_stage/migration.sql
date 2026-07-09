-- Add `Episode.stage` — fine-grained pipeline sub-state.
--
-- The pre-existing `status` enum lumped IMPORTING (RSS/YouTube fetch),
-- TRANSCRIBING (Deepgram), and GENERATING (Claude) under a single
-- PROCESSING value. The SSE stream on `/api/episodes/[id]/stream`
-- couldn't tell them apart, so the "Transcribing…" panel stayed mounted
-- through the whole run — even after Deepgram had landed the transcript
-- — until the router.refresh() triggered by the final PROCESSING → READY
-- flip finally repopulated the RSC props. That's the "stuck on
-- transcribing until reload" bug.
--
-- `stage` is authoritative for the pipeline sub-state going forward.
-- `status` stays as the coarse public column (dashboards, filtering,
-- ARCHIVED soft-delete).

-- 1. Enum
CREATE TYPE "EpisodePipelineStage" AS ENUM (
  'PENDING',
  'IMPORTING',
  'TRANSCRIBING',
  'GENERATING',
  'COMPLETED',
  'FAILED'
);

-- 2. Column (default PENDING so INSERTs without stage still work; the
--    pipeline functions will overwrite it on their first step).
ALTER TABLE "Episode"
  ADD COLUMN "stage" "EpisodePipelineStage" NOT NULL DEFAULT 'PENDING';

-- 3. Backfill existing rows so the UI doesn't render every historical
--    episode as PENDING. Mapping:
--      DRAFT      → PENDING       (never started)
--      PROCESSING → GENERATING    (best guess — most stuck rows are
--                                  mid-generate; if it's actually mid-
--                                  transcribe the next poll from the
--                                  Inngest function will overwrite it)
--      READY      → COMPLETED
--      ARCHIVED   → COMPLETED     (archived means it finished, then got
--                                  soft-deleted)
--      FAILED     → FAILED
UPDATE "Episode" SET "stage" = 'PENDING'    WHERE "status" = 'DRAFT';
UPDATE "Episode" SET "stage" = 'GENERATING' WHERE "status" = 'PROCESSING';
UPDATE "Episode" SET "stage" = 'COMPLETED'  WHERE "status" IN ('READY', 'ARCHIVED');
UPDATE "Episode" SET "stage" = 'FAILED'     WHERE "status" = 'FAILED';
