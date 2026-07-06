-- AlterTable: track the sample count at each `voiceDescription` refresh
-- so the drift-aware refresh gate can (a) fire periodic re-writes past
-- the fixed strength thresholds and (b) throttle drift-triggered
-- refreshes. Default 0 backfills existing rows to "never refreshed" —
-- the next approval crossing an original threshold still triggers as
-- before, and post-30 periodic refreshes align to the current count on
-- the first fire after this migration.
ALTER TABLE "Show" ADD COLUMN "voiceDescriptionSampleCount" INTEGER NOT NULL DEFAULT 0;
