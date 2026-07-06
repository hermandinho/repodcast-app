-- AlterTable: capture the operator's verdict on the current
-- `voiceDescription`. Nullable-by-default so every existing row starts
-- as "not rated yet" — the next time the description is regenerated the
-- refresh function keeps writing NULL here, and the /voice page shows
-- the rating affordance until the operator responds.
ALTER TABLE "Show" ADD COLUMN "voiceDescriptionApproved" BOOLEAN;
